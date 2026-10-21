import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import type { HomeHeroChip } from './chips';
import styles from './HomeStartPanel.module.css';

export interface HomeFeaturedTemplate {
  record: InstalledPluginRecord;
  chipId: string;
  title: string;
  poster: string;
  prompt: string;
}

interface Props {
  chips: HomeHeroChip[];
  activeChipId: string | null;
  activePluginId: string | null;
  templates: HomeFeaturedTemplate[];
  loading: boolean;
  pulseChipId?: string | null;
  pulseTemplate?: boolean;
  loadFailed: boolean;
  disabled: boolean;
  availablePluginIds: ReadonlySet<string>;
  labelFor: (id: string) => string;
  descriptionFor: (id: string) => string;
  onPickChip: (chip: HomeHeroChip) => void;
  onPreview: (record: InstalledPluginRecord) => void;
  onUse: (record: InstalledPluginRecord, chipId: string, prompt: string) => void;
  onBrowseTemplates?: () => void;
  onRetry?: () => void;
}

const PRIMARY_IDS = ['prototype', 'motion-design'];
const SECONDARY_IDS = ['video', 'deck', 'image'];

/** Home is a small introduction to the real catalogue, never a second library. */
export function HomeStartPanel({ chips, activeChipId, activePluginId, templates, loading,
  loadFailed, disabled, availablePluginIds, labelFor, descriptionFor, pulseChipId, pulseTemplate,
  onPickChip, onPreview, onUse, onBrowseTemplates, onRetry }: Props) {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const [failedPosters, setFailedPosters] = useState<ReadonlySet<string>>(() => new Set());
  const moreRef = useRef<HTMLDivElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const [morePosition, setMorePosition] = useState<CSSProperties>({});
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target)
        && !morePanelRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMoreOpen(false); moreTriggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);
  // The showcase scrolls independently of the composer. Portal the menu so
  // neither that scroll region nor a short window can crop its last actions.
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const position = () => {
      const rect = moreTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const down = below >= 280 || below >= above;
      setMorePosition({
        left: Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)),
        ...(down ? { top: rect.bottom + gap } : { bottom: window.innerHeight - rect.top + gap }),
        maxHeight: Math.max(80, Math.min(360, down ? below : above)),
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [moreOpen]);
  const primary = PRIMARY_IDS.flatMap((id) => chips.find((chip) => chip.id === id) ?? []);
  const secondary = SECONDARY_IDS.flatMap((id) => chips.find((chip) => chip.id === id) ?? []);
  const more = chips.filter((chip) => !PRIMARY_IDS.includes(chip.id) && !SECONDARY_IDS.includes(chip.id));
  const unavailable = (chip: HomeHeroChip) => disabled || loading || (
    chip.action.kind === 'apply-scenario' && !availablePluginIds.has(chip.action.pluginId)
  );
  const pick = (chip: HomeHeroChip) => { setMoreOpen(false); onPickChip(chip); };

  return <div className={styles.showcase} data-testid="home-start-panel">
    <div className={styles.content}>
      <h1 className={styles.brand}><img src="/logo.svg" alt="" width="36" height="36" />Open Design</h1>
      <div className={styles.primary} aria-label={t('homeHero.templatePicker.label')}>
        {primary.map((chip) => <Button key={chip.id} className={`${styles.taskCard}${pulseChipId === chip.id ? ' home-hero__attention-sheen' : ''}`}
          aria-pressed={activeChipId === chip.id} disabled={unavailable(chip)}
          data-testid={`home-hero-rail-${chip.id}`} onClick={() => pick(chip)}>
          <span className={styles.taskIcon}><Icon name={chip.icon} size={25} /></span>
          <span className={styles.taskCopy}><strong>{labelFor(chip.id)}</strong><span>{descriptionFor(chip.id)}</span></span>
          <Icon name="arrow-right" size={20} className={styles.taskArrow} />
        </Button>)}
      </div>
      <div className={styles.secondary}>
        {secondary.map((chip) => <Button key={chip.id} variant="ghost" className={styles.smallTask}
          aria-pressed={activeChipId === chip.id} disabled={unavailable(chip)}
          data-testid={`home-hero-rail-${chip.id}`} onClick={() => pick(chip)}>
          <Icon name={chip.icon} size={15} /><span>{labelFor(chip.id)}</span>
        </Button>)}
        <div ref={moreRef} className={styles.more}>
          <Button ref={moreTriggerRef} variant="ghost" className={styles.smallTask}
            aria-expanded={moreOpen} disabled={disabled || loading}
            onClick={() => setMoreOpen((open) => !open)} data-testid="home-start-more">
            {t('nextStep.more')}<Icon name="chevron-down" size={13} />
          </Button>
          {moreOpen ? createPortal(<div ref={morePanelRef} className={styles.morePanel} style={morePosition}
            aria-label={t('homeHero.templatePicker.label')}>
            {more.map((chip) => <Button key={chip.id} variant="ghost" className={styles.moreItem}
              aria-pressed={activeChipId === chip.id} disabled={unavailable(chip)}
              data-testid={`home-hero-rail-${chip.id}`} onClick={() => pick(chip)}>
              <Icon name={chip.icon} size={16} /><span>{labelFor(chip.id)}</span>
              {activeChipId === chip.id ? <Icon name="check" size={14} /> : null}
            </Button>)}
          </div>, document.body) : null}
        </div>
      </div>
      {loading ? <div className={styles.templates} role="status" aria-label={t('common.loading')}>
        <div className={styles.skeleton} /><div className={styles.skeleton} />
      </div> : loadFailed ? <div className={styles.empty} role="alert">
        <span>{t('homeStart.loadFailed')}</span><Button onClick={onRetry}>{t('preview.retry')}</Button>
      </div> : templates.length ? <div className={styles.templates} data-testid="home-hero-plugin-presets">
        {templates.slice(0, 2).map((template, index) => <article key={template.record.id} className={styles.template}
          data-selected={activePluginId === template.record.id || undefined} data-plugin-id={template.record.id}>
          <Button className={`${styles.preview}${pulseTemplate && index === 0 ? ' home-hero__attention-sheen' : ''}`} onClick={() => onPreview(template.record)}
            aria-label={`${t('common.preview')}: ${template.title}`}>
            {failedPosters.has(template.poster) ? <span className={styles.previewFailure}><Icon name="image" size={22} />{t('preview.unavailableTitle')}</span>
              : <img src={template.poster} alt="" loading="lazy" decoding="async"
                onError={() => setFailedPosters((current) => new Set([...current, template.poster]))} />}
            <span className={styles.typeBadge}>{labelFor(template.chipId)}</span>
          </Button>
          <div className={styles.caption}>
            <Button variant="ghost" className={styles.templateName} disabled={disabled}
              title={template.title} data-plugin-id={template.record.id} data-testid="home-hero-plugin-preset"
              onClick={() => onUse(template.record, template.chipId, template.prompt)}>
              {template.title}
            </Button>
            <Button variant="ghost" size="sm" className={styles.use} disabled={disabled}
              aria-label={`${t('pluginCard.use')}: ${template.title}`}
              onClick={() => onUse(template.record, template.chipId, template.prompt)}>{t('pluginCard.use')}<Icon name="arrow-right" size={12} /></Button>
          </div>
        </article>)}
      </div> : <p className={styles.empty}>{t('homeStart.noTemplates')}</p>}
      {onBrowseTemplates ? <Button variant="ghost" className={styles.allTemplates} onClick={onBrowseTemplates}>
        {t('homeStart.allTemplates')}<Icon name="arrow-right" size={14} />
      </Button> : null}
    </div>
  </div>;
}
