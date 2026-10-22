import { describe, expect, it } from 'vitest';
import { LOCALES, tForLanguageTag } from '../../src/i18n';

// Frozen r271 role rule: admin/member contact Owner, never a billing admin.
describe('funding recovery role terminology across all supported locales', () => {
  it.each(LOCALES.filter((locale) => locale !== 'zh-CN'))('%s identifies the same Owner role used in membership UI', (locale) => {
    const t = tForLanguageTag(locale)!;
    const ownerRole = t('collabPresence.roleOwner').toLocaleLowerCase();
    for (const key of ['chat.amrBalanceOwner.message', 'chat.amrBalanceOwner.messageNoOwnerName', 'chat.upgrade.pausedTeamMessage'] as const) {
      expect(t(key).toLocaleLowerCase(), key).toContain(ownerRole);
    }
  });

  it('zh-CN keeps the frozen F10 notice and names Owner in the other recovery copy', () => {
    const t = tForLanguageTag('zh-CN')!;
    // Frozen client design r506 / F10 specifies this exact visible sentence.
    const frozenF10 = '当前团队额度不足，请联系团队空间所有者充值或升级订阅。';
    expect(t('chat.amrBalanceOwner.message')).toBe(frozenF10);
    expect(t('chat.amrBalanceOwner.messageNoOwnerName')).toBe(frozenF10);
    expect(t('chat.upgrade.pausedTeamMessage').toLocaleLowerCase())
      .toContain(t('collabPresence.roleOwner').toLocaleLowerCase());
  });
});
