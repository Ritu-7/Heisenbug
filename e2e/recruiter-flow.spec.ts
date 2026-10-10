import { test, expect } from '@playwright/test';

test.describe('Recruiter Flow', () => {
  test('sign in as recruiter, create assessment, invite candidate, candidate takes assessment with locked tabs and countdown, submits, recruiter sees SUBMITTED', async ({
    page,
    browser,
    request,
  }) => {
    // 1. Sign in as recruiter via API
    const loginRes = await request.post('http://localhost:3001/api/auth/login', {
      data: {
        email: 'recruiter@heisenbug.dev',
        password: 'recruiterpassword123',
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = await loginRes.json();
    expect(token).toBeTruthy();

    await page.addInitScript((authToken) => {
      localStorage.setItem('heisenbug_jwt_token', authToken);
    }, token);

    // 2. Open recruiter dashboard
    await page.goto('/recruiter/dashboard');
    await expect(page.getByRole('heading', { name: 'Recruiter Dashboard' })).toBeVisible();

    // 3. Create a real assessment
    const newAssessmentBtn = page.getByRole('button', { name: '+ New Assessment' });
    await expect(newAssessmentBtn).toBeVisible();
    await newAssessmentBtn.click();

    await expect(page.getByRole('heading', { name: 'New Assessment' })).toBeVisible();
    const assessmentTitle = `E2E Playwright Assessment ${Date.now()}`;
    await page.fill('input[placeholder*="Senior Backend Engineer"]', assessmentTitle);

    // Select the target problem radio button
    const problemRadio = page.locator('input[type="radio"][name="problemVersionId"]').first();
    await problemRadio.check();

    // Submit assessment creation form
    await page.getByRole('button', { name: 'Create Assessment' }).click();

    // 4. Open the created assessment detail page
    const assessmentLink = page.locator(`a:has-text("${assessmentTitle}")`);
    await expect(assessmentLink).toBeVisible({ timeout: 15_000 });
    await assessmentLink.click();

    await page.waitForURL('**/recruiter/assessments/*');
    await expect(page.getByRole('heading', { name: assessmentTitle })).toBeVisible();

    // 5. Invite a candidate
    const candidateEmail = `playwright-candidate-${Date.now()}@example.com`;
    await page.fill('input[placeholder="candidate@example.com"]', candidateEmail);
    await page.getByRole('button', { name: 'Invite →' }).click();

    // 6. Confirm invite banner renders and extract invite link
    const inviteBanner = page.locator('text=Invitation created — share this link:').locator('..');
    await expect(inviteBanner).toBeVisible({ timeout: 15_000 });

    const inviteUrlElement = inviteBanner.locator('p.break-all');
    await expect(inviteUrlElement).toBeVisible();
    const inviteUrl = (await inviteUrlElement.innerText()).trim();
    expect(inviteUrl).toContain('/invite/');

    // Confirm candidate row is currently listed in INVITED status
    await expect(page.locator(`text=${candidateEmail}`)).toBeVisible();
    await expect(page.locator('text=Invited').first()).toBeVisible();

    // 7. Open invite link in a fresh browser context (incognito candidate session)
    const incognitoContext = await browser.newContext();
    const candidatePage = await incognitoContext.newPage();

    await candidatePage.goto(inviteUrl);
    await expect(candidatePage.getByRole('heading', { name: assessmentTitle })).toBeVisible();
    await expect(candidatePage.locator(`text=${candidateEmail}`)).toBeVisible();

    // 8. Start the assessment
    const startBtn = candidatePage.getByRole('button', { name: 'Start Assessment →' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 9. Confirm candidate arrives on the problem workspace
    await candidatePage.waitForURL(/\/problems\/.*sessionId=/);

    // 10. Confirm locked tabs (Hints, Editorial, Solution disabled with lock icon)
    const hintsTab = candidatePage.locator('button:has-text("Hints")');
    await expect(hintsTab).toBeDisabled();
    const editorialTab = candidatePage.locator('button:has-text("Editorial")');
    await expect(editorialTab).toBeDisabled();
    const solutionTab = candidatePage.locator('button:has-text("Solution")');
    await expect(solutionTab).toBeDisabled();
    await expect(candidatePage.locator('text=🔒').first()).toBeVisible();

    // 11. Confirm real countdown timer renders
    await expect(candidatePage.locator('text=⏱')).toBeVisible();

    // 12. Submit the assessment
    const submitBtn = candidatePage.getByRole('button', { name: /^Submit$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });
    await submitBtn.click();
    const skipBtn = candidatePage.locator('text=Skip & Submit');
    if (await skipBtn.isVisible({ timeout: 2000 })) {
      await skipBtn.click();
    }

    // Wait for submit verdict to appear on the candidate page
    await expect(candidatePage.locator('text=Submit verdict')).toBeVisible({ timeout: 60_000 });

    // 13. Back in recruiter's view, confirm status updates to real SUBMITTED
    // The recruiter page refetches every 2 seconds
    const candidateRow = page.locator('div', { has: page.locator(`text="${candidateEmail}"`) }).filter({ hasText: 'Expires' }).first();
    await expect(candidateRow.locator('text=Submitted')).toBeVisible({ timeout: 20_000 });

    // Clean up incognito context
    await incognitoContext.close();
  });
});
