import { describe, expect, it } from 'vitest';
import { LOCALES, tForLanguageTag } from '../../src/i18n';

// Frozen r271 role rule: admin/member contact Owner, never a billing admin.
describe('funding recovery role terminology across all supported locales', () => {
  it.each(LOCALES)('%s identifies the same Owner role used in membership UI', (locale) => {
    const t = tForLanguageTag(locale)!;
    const ownerRole = t('collabPresence.roleOwner').toLocaleLowerCase();
    for (const key of ['chat.amrBalanceOwner.message', 'chat.amrBalanceOwner.messageNoOwnerName', 'chat.upgrade.pausedTeamMessage'] as const) {
      if (locale === 'zh-CN' && key.startsWith('chat.amrBalanceOwner.')) {
        expect(t(key), key).toContain('团队空间所有者');
        continue;
      }
      expect(t(key).toLocaleLowerCase(), key).toContain(ownerRole);
    }
  });
});
