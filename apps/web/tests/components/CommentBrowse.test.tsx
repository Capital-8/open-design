// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { CommentAvatarRail, CommentHoverPreview, useCommentHoverPreview } from '../../src/components/CommentBrowse';
import type { PreviewComment } from '../../src/types';
const comment = (i: number): PreviewComment => ({ id: String(i), projectId:'p', conversationId:'c', filePath:'index.html', elementId:'hero', selector:'#hero', label:'Hero', text:'', htmlHint:'', position:{ x:0,y:0,width:10,height:10 }, note:`Note ${i}`, status:'open', authorDisplayName:'Alice', createdAt:i, updatedAt:i });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Rail({ count, onExpand = vi.fn(), onOpen = vi.fn(), suppressed = false }: { count: number; onExpand?: () => void; onOpen?: (comment: PreviewComment) => void; suppressed?: boolean }) {
  const hover = useCommentHoverPreview(suppressed);
  const ref = useRef<HTMLButtonElement>(null);
  return <><CommentAvatarRail comments={Array.from({ length:count }, (_,i)=>comment(i))} activeId={null} unreadIds={new Set(['5'])} toggleRef={ref} hover={hover} label={c=>c.note} moreLabel={n=>`Remaining ${n}`} renderAvatar={()=>'A'} onExpand={onExpand} onOpen={onOpen}/><CommentHoverPreview state={hover} author="Alice" /></>;
}
it.each([[0,1,null],[1,2,null],[5,6,null],[6,6,'+1'],[15,6,'+10'],[105,6,'+99']])('H01–06: %i comments retain five avatar slots and a passive capped count', (count, buttons, more) => {
  render(<Rail count={count}/>);
  expect(screen.getAllByRole('button')).toHaveLength(buttons);
  if (more) expect(screen.getByText(more).tagName).toBe('SPAN');
  else expect(screen.queryByText(/^\+/)).toBeNull();
  if (count===105) expect(screen.getByText('+99')).toHaveAttribute('aria-label','Remaining 100');
});
it('H05/H12: only the toggle expands; avatar opens its comment and count is inert', () => {
  const onExpand=vi.fn(), onOpen=vi.fn(); render(<Rail count={15} onExpand={onExpand} onOpen={onOpen}/>);
  fireEvent.click(screen.getByText('+10')); expect(onExpand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Note 0'})); expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({id:'0'})); expect(onExpand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Show comments'})); expect(onExpand).toHaveBeenCalledOnce();
});
it('H11: draft suppresses preview; hover has 200ms leave grace and 100ms fade', () => {
  vi.useFakeTimers(); const {rerender}=render(<Rail count={1}/>);
  const avatar=screen.getByRole('button',{name:'Note 0'});
  vi.spyOn(avatar,'getBoundingClientRect').mockReturnValue({left:400,right:430,top:100,bottom:130,width:30,height:30,x:400,y:100,toJSON:()=>({})});
  fireEvent.mouseEnter(avatar); expect(screen.getByRole('tooltip')).toHaveTextContent('Note 0');
  fireEvent.mouseLeave(avatar); act(()=>vi.advanceTimersByTime(199)); expect(screen.getByRole('tooltip')).toBeTruthy();
  act(()=>vi.advanceTimersByTime(101)); expect(screen.queryByRole('tooltip')).toBeNull();
  rerender(<Rail count={1} suppressed/>); fireEvent.mouseEnter(avatar); expect(screen.queryByRole('tooltip')).toBeNull();
});
