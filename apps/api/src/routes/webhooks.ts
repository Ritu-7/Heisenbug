import { Router, Request, Response } from "express";
import { Webhook } from "svix";
import { Role, ApprovalStatus } from "@prisma/client";
import { clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma";
import { invalidateClerkUserCache } from "../middleware/auth";

const router = Router();

/**
 * POST /api/webhooks/clerk
 *
 * Verifies the Clerk webhook signature using Svix and keeps Postgres User rows
 * in sync as a mirror on user.created and user.updated events.
 */
router.post("/clerk", async (req: Request, res: Response): Promise<void> => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhooks] Missing CLERK_WEBHOOK_SECRET in environment");
    res.status(500).json({ ok: false, error: "Webhook secret not configured on server" });
    return;
  }

  // Retrieve Svix headers
  const svixId = req.headers["svix-id"] as string | undefined;
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
  const svixSignature = req.headers["svix-signature"] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ ok: false, error: "Missing required svix signature headers" });
    return;
  }

  // Get raw body for verification
  const rawBody = (req as any).rawBody
    ? (req as any).rawBody.toString("utf8")
    : typeof req.body === "string"
    ? req.body
    : JSON.stringify(req.body);

  const wh = new Webhook(webhookSecret);
  let event: any;

  try {
    wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
    event = typeof req.body === "object" && !(req.body instanceof Buffer)
      ? req.body
      : JSON.parse(rawBody);
  } catch (err: any) {
    console.error("[webhooks] Webhook signature verification failed:", err.message);
    res.status(400).json({ ok: false, error: `Invalid webhook signature: ${err.message}` });
    return;
  }

  const { type, data } = event;
  console.log(`[webhooks] Received Clerk event '${type}' for user ${data?.id}`);

  if (type === "user.created" || type === "user.updated") {
    const userId = data.id;
    const primaryEmailId = data.primary_email_address_id;
    const emailObj =
      data.email_addresses?.find((e: any) => e.id === primaryEmailId) ||
      data.email_addresses?.[0];
    const email = (emailObj?.email_address || "").toLowerCase().trim();

    const fullName = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
    const name = fullName || email.split("@")[0] || "User";

    // Role, requestedRole, and approvalStatus live strictly in Clerk's private metadata
    const privateMeta = data.private_metadata || {};
    let rawRole = privateMeta.role;
    let requestedRole = privateMeta.requestedRole ?? null;
    let approvalStatus = privateMeta.approvalStatus ?? "NONE";

    // New users default to role: "CANDIDATE", approvalStatus: "NONE" in private metadata
    if (!rawRole) {
      rawRole = "CANDIDATE";
      try {
        await clerkClient.users.updateUserMetadata(userId, {
          privateMetadata: {
            ...privateMeta,
            role: "CANDIDATE",
            approvalStatus: approvalStatus,
            requestedRole: requestedRole,
          },
        });
      } catch (clerkErr) {
        console.error("[webhooks] Failed to initialize default privateMetadata on Clerk:", clerkErr);
      }
    }

    const validRoles: Role[] = ["CANDIDATE", "RECRUITER", "AUTHOR", "ADMIN"];
    const role: Role = validRoles.includes(rawRole as Role) ? (rawRole as Role) : "CANDIDATE";
    const validApprovalStatuses: ApprovalStatus[] = ["NONE", "PENDING", "APPROVED", "REJECTED"];
    const status: ApprovalStatus = validApprovalStatuses.includes(approvalStatus as ApprovalStatus)
      ? (approvalStatus as ApprovalStatus)
      : "NONE";
    const reqRole: Role | null = validRoles.includes(requestedRole as Role)
      ? (requestedRole as Role)
      : null;

    try {
      const existingByEmail = email ? await prisma.user.findUnique({ where: { email } }) : null;

      if (existingByEmail && existingByEmail.id !== userId) {
        // Re-link existing user records to the new Clerk ID
        await prisma.$transaction(async (tx) => {
          const target = await tx.user.findUnique({ where: { id: userId } });
          if (!target) {
            const tempEmail = `${email}.sync-${Date.now()}`;
            const created = await tx.user.create({
              data: {
                id: userId,
                email: tempEmail,
                name,
                role,
                requestedRole: reqRole,
                approvalStatus: status,
              },
            });
            await tx.session.updateMany({ where: { userId: existingByEmail.id }, data: { userId: created.id } });
            await tx.assessment.updateMany({ where: { recruiterId: existingByEmail.id }, data: { recruiterId: created.id } });
            await tx.user.delete({ where: { id: existingByEmail.id } });
            await tx.user.update({ where: { id: created.id }, data: { email } });
          } else {
            await tx.session.updateMany({ where: { userId: existingByEmail.id }, data: { userId: target.id } });
            await tx.assessment.updateMany({ where: { recruiterId: existingByEmail.id }, data: { recruiterId: target.id } });
            await tx.user.delete({ where: { id: existingByEmail.id } });
            await tx.user.update({
              where: { id: target.id },
              data: {
                email,
                name,
                role,
                requestedRole: reqRole,
                approvalStatus: status,
              },
            });
          }
        });
      } else {
        await prisma.user.upsert({
          where: { id: userId },
          update: {
            email,
            name,
            role,
            requestedRole: reqRole,
            approvalStatus: status,
          },
          create: {
            id: userId,
            email,
            name,
            role,
            requestedRole: reqRole,
            approvalStatus: status,
          },
        });
      }

      invalidateClerkUserCache(userId);
      console.log(`[webhooks] Successfully synced user ${userId} (${email}, role=${role}, status=${status}) in Postgres`);
    } catch (dbErr: any) {
      console.error("[webhooks] Database error while syncing user:", dbErr);
      res.status(500).json({ ok: false, error: "Failed to sync user to database" });
      return;
    }
  }

  res.json({ ok: true, received: true, event: type });
});

export default router;
