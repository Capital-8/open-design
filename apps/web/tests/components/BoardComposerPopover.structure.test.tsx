// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AnnotationHoverPopover, BoardComposerPopover } from '../../src/components/BoardComposerPopover';
import styles from '../../src/components/CommentComposer.module.css';

afterEach(cleanup);
const props: ComponentProps<typeof BoardComposerPopover> = {
  target:{filePath:'index.html',elementId:'hero',selector:'#hero',label:'Hero',text:'',htmlHint:'',position:{x:80,y:100,width:200,height:80}},
  existing:null,draft:'Keep this draft',notes:[],sending:false,
  onDraft:vi.fn(),onAddDraft:vi.fn(),onRemoveQueuedNote:vi.fn(),onClose:vi.fn(),onSaveComment:vi.fn(),onSendBatch:vi.fn(),onRemoveMember:vi.fn(),
  t:key=>key,markerRect:{left:100,top:100,width:28,height:28},bounds:{width:800,height:600},
};
it('draft mounts no header, retired handle, view-all entry, or legacy skin DOM', () => {
  render(<BoardComposerPopover {...props}/>);
  const dialog=screen.getByRole('dialog',{name:'chat.comments.comment: Hero'});
  expect(dialog.className).toBe(styles.popover);
  expect(dialog.querySelector(`.${styles.header}`)).toBeNull();
  expect(screen.queryByLabelText('Move comment box')).toBeNull();
  expect(screen.queryByTestId('comment-popover-view-all')).toBeNull();
  expect(dialog.querySelector('[class*="comment-popover"]')).toBeNull();
  expect(screen.getByTestId('comment-popover-input')).toHaveValue('Keep this draft');
  fireEvent.click(screen.getByTestId('comment-popover-save'));
  expect(props.onSaveComment).toHaveBeenCalledOnce();
});
it('detail mounts its real author, menu and close while keeping the old controls absent', () => {
  const close=vi.fn();
  render(<BoardComposerPopover {...props} onClose={close} locationNotice="Position may have changed" author={<span>Alice</span>} existing={{...props.target,id:'comment-1',projectId:'project',conversationId:'conversation',note:'Read only detail',status:'open',createdAt:1,updatedAt:1}}/>);
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.getByRole('status')).toHaveTextContent('Position may have changed');
  expect(screen.getByLabelText('comment.moreActions')).toBeTruthy();
  expect(screen.queryByLabelText('Move comment box')).toBeNull();
  expect(screen.queryByTestId('comment-popover-view-all')).toBeNull();
  expect(screen.queryByTestId('comment-popover-input')).toBeNull();
  expect(screen.getByTestId('comment-popover-detail')).toHaveTextContent('Read only detail');
  fireEvent.click(screen.getByLabelText('common.close'));
  expect(close).toHaveBeenCalledOnce();
});
it('the independent annotation hover retains its existing global surface', () => {
  render(<AnnotationHoverPopover target={{...props.target,style:{color:'#f00'}}} scale={1} bounds={{width:800,height:600}}/>);
  expect(screen.getByTestId('annotation-hover-popover')).toHaveClass('comment-popover','annotation-hover-popover');
  expect(screen.getByTestId('annotation-hover-style-summary')).toHaveTextContent('Color');
});
