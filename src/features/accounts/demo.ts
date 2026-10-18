import { DEMO_ACCOUNT_ID, openDemoAccount } from '@/lib/storage/accounts';
import { getProfile } from '@/lib/storage/repositories';
import { createDemoProfile } from '@/features/onboarding/demoProfile';

export { DEMO_ACCOUNT_ID };

/** Opens the demo account, generating its sample history the first time (or after it was emptied). */
export function exploreDemo(): Promise<void> {
  return openDemoAccount(async () => {
    if (!(await getProfile())) await createDemoProfile();
  });
}
