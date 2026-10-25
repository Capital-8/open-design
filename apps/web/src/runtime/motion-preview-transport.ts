import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  MOTION_PREVIEW_COMMAND, MOTION_PREVIEW_CONNECT, MOTION_PREVIEW_STATE,
  type MotionPlayerControl, type MotionPlayerRestore, type MotionPlayerState, type MotionPreviewStateMessage,
} from '@open-design/contracts/runtime/motion-source-player';

export type MotionTransportError = 'motion.unavailable' | 'motion.commandFailed' | 'motion.previewChanged';
interface Snapshot {
  state: MotionPlayerState | null;
  connected: boolean;
  error: MotionTransportError | null;
  documentToken: string | null;
  epoch: number;
}
const EMPTY: Snapshot = { state: null, connected: false, error: null, documentToken: null, epoch: 0 };
const token = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function isMotionPlayerState(value: unknown): value is MotionPlayerState {
  if (!value || typeof value !== 'object') return false;
  const state = value as MotionPlayerState;
  return ['playing', 'active', 'muted', 'locked'].every(key => typeof state[key as keyof MotionPlayerState] === 'boolean')
    && Number.isFinite(state.time) && Number.isFinite(state.duration)
    && state.duration > 0 && state.time >= 0 && state.time <= state.duration + .001
    && (state.userMuted === undefined || typeof state.userMuted === 'boolean')
    && (state.fps === undefined || (Number.isFinite(state.fps) && state.fps > 0 && state.fps <= 240));
}

/** A WindowProxy survives navigation. A new host challenge AND a document
 * instance fence every acknowledgement; source checking alone is insufficient. */
export class MotionPreviewTransport {
  private frame: HTMLIFrameElement | null = null;
  private identity = '';
  private contentIdentity = '';
  private enabled = false;
  private waitingForLoad = false;
  private clientId: string | null = null;
  private instance: string | null = null;
  private connectRequest: string | null = null;
  private connectRestore: MotionPlayerRestore | null = null;
  private lastPaused: { contentIdentity: string; state: MotionPlayerState } | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private sourceAttributes = '';
  private documents = new WeakMap<HTMLIFrameElement, { identity: string; attributes: string }>();
  private frameLoads = new Map<HTMLIFrameElement, () => void>();
  private snapshot: Snapshot = EMPTY;
  private pending = new Map<string, {
    resolve(state: MotionPlayerState): void; reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private changed: (snapshot: Snapshot) => void,
    private isCurrent: (frame: HTMLIFrameElement, identity: string) => boolean = () => true,
    private currentBinding?: () => { frame: HTMLIFrameElement | null; identity: string; contentIdentity?: string; enabled: boolean },
  ) {}

  private isLive() { return !!this.frame && this.enabled && !this.waitingForLoad && this.isCurrent(this.frame, this.identity) && this.attributes() === this.sourceAttributes; }
  getState = () => this.isLive() ? this.snapshot.state : null;
  getDocumentToken = () => this.isLive() ? this.snapshot.documentToken : null;
  getContentIdentity = () => this.contentIdentity;
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changed(this.snapshot);
  }
  private attributes(frame = this.frame) { return `${frame?.getAttribute('src') ?? ''}\n${frame?.getAttribute('srcdoc') ?? ''}`; }
  private setContentIdentity(value: string) {
    if (value !== this.contentIdentity) { this.lastPaused = null; this.contentIdentity = value; }
  }
  private clearSession(waitForLoad: boolean) {
    this.waitingForLoad = waitForLoad;
    this.clientId = null; this.instance = null; this.connectRequest = null; this.connectRestore = null;
    clearTimeout(this.connectTimer);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer); request.reject(new Error('motion.previewChanged'));
    }
    this.pending.clear();
    this.publish({ ...EMPTY, epoch: this.snapshot.epoch + 1 });
  }
  /** Call synchronously before host-controlled navigation starts. */
  invalidate = () => { this.clearSession(true); };
  onLoad = () => {
    if (!this.frame) return;
    // A cached srcdoc can finish loading before the passive binding effect.
    // Read the identity from the current render, never attach it to the old
    // document merely because the WindowProxy is the same.
    const latest = this.currentBinding?.();
    if (latest?.frame === this.frame) {
      this.identity = latest.identity; this.enabled = latest.enabled;
      this.setContentIdentity(latest.contentIdentity ?? latest.identity);
    }
    this.sourceAttributes = this.attributes();
    this.documents.set(this.frame, { identity: this.identity, attributes: this.sourceAttributes });
    this.clearSession(false);
    if (this.enabled && this.isCurrent(this.frame, this.identity)) this.connect();
  };
  bind(frame: HTMLIFrameElement | null, identity: string, enabled: boolean, contentIdentity = identity) {
    if (frame === this.frame && identity === this.identity && enabled === this.enabled && contentIdentity === this.contentIdentity) return;
    const oldFrame = this.frame;
    const changedSource = oldFrame === frame && this.attributes() !== this.sourceAttributes;
    const changedIdentity = oldFrame === frame && (identity !== this.identity || contentIdentity !== this.contentIdentity);
    const knownDocument = frame ? this.documents.get(frame) : undefined;
    const waitingForLoad = (oldFrame === frame && (this.waitingForLoad || changedSource || changedIdentity))
      || (!!knownDocument && (knownDocument.identity !== identity || knownDocument.attributes !== this.attributes(frame)));
    this.detach();
    this.frame = frame; this.identity = identity; this.enabled = enabled;
    this.setContentIdentity(contentIdentity);
    this.clearSession(waitingForLoad);
    // Keep listening while this preview is inactive. A background navigation
    // may finish there; reactivation must not wait for a load that already ran.
    if (!frame) return;
    this.sourceAttributes = this.attributes();
    frame.ownerDocument.defaultView?.addEventListener('message', this.onMessage);
    if (!this.frameLoads.has(frame)) {
      const onLoad = () => {
        if (frame === this.frame) this.onLoad();
        // A parked frame really navigated while another transport was active.
        // Its old document binding is gone; reconnect to its loaded instance
        // when selected, rather than waiting for an already-finished load.
        else this.documents.delete(frame);
      };
      this.frameLoads.set(frame, onLoad); frame.addEventListener('load', onLoad);
    }
    this.observer = new MutationObserver(() => {
      if (this.attributes() === this.sourceAttributes) return;
      this.sourceAttributes = this.attributes(); this.invalidate();
    });
    this.observer.observe(frame, { attributes: true, attributeFilter: ['src', 'srcdoc'] });
    if (!this.waitingForLoad) this.connect();
  }
  private connect() {
    if (!this.frame?.contentWindow || !this.enabled || this.waitingForLoad) return;
    this.clientId = token(); this.connectRequest = token();
    const paused = this.lastPaused?.contentIdentity === this.contentIdentity ? this.lastPaused.state : null;
    this.connectRestore = paused ? { time: paused.time, locked: paused.locked, muted: paused.userMuted ?? false } : null;
    this.frame.contentWindow.postMessage({ type: MOTION_PREVIEW_CONNECT, clientId: this.clientId, requestId: this.connectRequest,
      ...(this.connectRestore ? { restore: this.connectRestore } : {}) }, '*');
    // The source waits up to 15s for authored dependencies to register a clock.
    this.connectTimer = setTimeout(() => this.publish({ error: 'motion.unavailable' }), 16_000);
  }
  private onMessage = (event: MessageEvent) => {
    if (!this.enabled || this.waitingForLoad || !this.frame || !this.isCurrent(this.frame, this.identity)
      || event.source !== this.frame.contentWindow || !event.source) return;
    if (this.attributes() !== this.sourceAttributes) { this.sourceAttributes = this.attributes(); this.invalidate(); return; }
    const message = event.data as Partial<MotionPreviewStateMessage> | null;
    if (message?.type !== MOTION_PREVIEW_STATE || !this.clientId || message.clientId !== this.clientId
      || typeof message.instance !== 'string' || !message.instance || message.instance.length > 160) return;
    const connecting = this.instance === null;
    if (connecting ? message.requestId !== this.connectRequest : message.instance !== this.instance) return;
    if (connecting && this.connectRestore && (message.restored !== true || message.error)) {
      clearTimeout(this.connectTimer);
      this.publish({ error: 'motion.unavailable', connected: false, state: null, documentToken: null });
      return;
    }
    if (message.requestId !== null && typeof message.requestId !== 'string') return;
    if (!connecting && message.requestId !== null && !this.pending.has(message.requestId!)) return;
    if (!isMotionPlayerState(message.state)) {
      if (!message.error) return;
      clearTimeout(this.connectTimer);
      this.publish({ error: 'motion.unavailable', connected: false, state: null, documentToken: null });
      return;
    }
    if (connecting && this.connectRestore && (message.state.playing || message.state.locked !== this.connectRestore.locked
      || Math.abs(message.state.time - this.connectRestore.time) > .001)) {
      clearTimeout(this.connectTimer);
      this.publish({ error: 'motion.unavailable', connected: false, state: null, documentToken: null });
      return;
    }
    clearTimeout(this.connectTimer);
    this.instance = message.instance;
    this.documents.set(this.frame, { identity: this.identity, attributes: this.sourceAttributes });
    // An activity-driven hide is not a user pause. Preserve only confirmed
    // active pauses, and forget them as soon as the user resumes playback.
    if (message.state.active) {
      this.lastPaused = message.state.playing ? null : { contentIdentity: this.contentIdentity, state: message.state };
    }
    const request = message.requestId ? this.pending.get(message.requestId) : undefined;
    if (request) { clearTimeout(request.timer); this.pending.delete(message.requestId!); }
    this.publish({ state: message.state, connected: true, error: message.error ? 'motion.commandFailed' : null,
      documentToken: `${this.clientId}:${this.instance}` });
    if (message.error) request?.reject(new Error('motion.commandFailed'));
    else request?.resolve(message.state);
  };
  command = (control: MotionPlayerControl): Promise<MotionPlayerState> => {
    const frame = this.frame;
    if (!this.isLive() || !frame?.contentWindow || !this.clientId || !this.instance || !this.snapshot.connected) {
      return Promise.reject(new Error('motion.unavailable'));
    }
    if (control.action === 'seek' && !Number.isFinite(control.time)) return Promise.reject(new Error('motion.commandFailed'));
    const requestId = token();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId); this.publish({ error: 'motion.commandFailed' }); reject(new Error('motion.commandFailed'));
      }, 2500);
      this.pending.set(requestId, { resolve, reject, timer });
      try { frame.contentWindow!.postMessage({ type: MOTION_PREVIEW_COMMAND, clientId: this.clientId, instance: this.instance, requestId, control }, '*'); }
      catch { clearTimeout(timer); this.pending.delete(requestId); this.publish({ error: 'motion.commandFailed' }); reject(new Error('motion.commandFailed')); }
    });
  };
  private detach() {
    this.frame?.ownerDocument.defaultView?.removeEventListener('message', this.onMessage);
    this.observer?.disconnect(); this.observer = null;
  }
  dispose() {
    this.detach();
    for (const [frame, onLoad] of this.frameLoads) frame.removeEventListener('load', onLoad);
    this.frameLoads.clear();
    this.lastPaused = null;
    this.clearSession(true); this.frame = null; this.enabled = false;
  }
}

export function useMotionPreviewTransport(options: {
  iframeRef: RefObject<HTMLIFrameElement>; identity: string; contentIdentity?: string; enabled: boolean; locked?: boolean;
}) {
  const current = useRef(options); current.current = options;
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const controllerRef = useRef<MotionPreviewTransport>();
  if (!controllerRef.current) controllerRef.current = new MotionPreviewTransport(setSnapshot,
    (frame, identity) => {
      const latest = current.current;
      return latest.enabled && latest.identity === identity && (latest.contentIdentity ?? latest.identity) === controllerRef.current?.getContentIdentity()
        && latest.iframeRef.current === frame;
    },
    () => ({ frame: current.current.iframeRef.current, identity: current.current.identity, contentIdentity: current.current.contentIdentity, enabled: current.current.enabled }),
  );
  const controller = controllerRef.current;
  // FileViewer selects its active iframe in an effect. Bind again after that
  // commit's effects, without polling a parked or hidden iframe.
  useEffect(() => {
    let cancelled = false;
    const bind = () => { if (!cancelled) controller.bind(current.current.iframeRef.current, current.current.identity, current.current.enabled, current.current.contentIdentity); };
    bind(); queueMicrotask(bind);
    return () => { cancelled = true; };
  });
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (snapshot.connected && snapshot.state?.locked !== !!options.locked) {
      void controller.command({ action: 'lock', value: !!options.locked }).catch(() => {});
    }
  }, [controller, options.locked, snapshot.connected]);
  const requestPause = useCallback(() => controller.command({ action: 'pause' }), [controller]);
  const setLocked = useCallback((value: boolean) => controller.command({ action: 'lock', value }), [controller]);
  return { ...snapshot, state: controller.getState(), connected: snapshot.connected && controller.getDocumentToken() !== null,
    documentToken: controller.getDocumentToken(), command: controller.command, requestPause, setLocked,
    invalidate: controller.invalidate, onLoad: controller.onLoad,
    getDocumentToken: controller.getDocumentToken, getState: controller.getState };
}
