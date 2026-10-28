// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionExportButton } from '../../../src/components/MotionExportButton/Web';
const motionSource = '<main data-composition-id="main" data-duration="2">Motion</main>';
const { exportMp4 } = vi.hoisted(() => ({ exportMp4: vi.fn() }));
vi.mock('../../../src/runtime/exports', async () => ({
  ...await vi.importActual('../../../src/runtime/exports'), exportProjectAsMp4: exportMp4,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('prevents duplicate export and makes errors retryable', async () => {
  let fail!: (e: Error) => void;
  exportMp4.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue('download');
  render(<MotionExportButton source={motionSource} projectId="p" fileName="index.html" title="Film" />);
  fireEvent.click(screen.getByRole('button', { name: 'MP4' }));
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  fail(new Error('Soundtrack missing'));
  expect((await screen.findByRole('alert')).textContent).toContain('Soundtrack missing');
  fireEvent.click(screen.getByRole('button', { name: 'MP4' }));
  await waitFor(() => expect(exportMp4).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('cancels a download when its project or preview is closed', () => {
  exportMp4.mockImplementation(() => new Promise(() => {}));
  const view = render(<MotionExportButton source={motionSource} projectId="p" fileName="index.html" title="Film" />);
  fireEvent.click(screen.getByRole('button'));
  const signal = exportMp4.mock.calls[0]![0].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it('cancels a pending export when the source stops being a motion artifact', () => {
  exportMp4.mockImplementation(() => new Promise(() => {}));
  const view = render(<MotionExportButton source={motionSource} projectId="p" fileName="index.html" title="Film" />);
  fireEvent.click(screen.getByRole('button'));
  const signal = exportMp4.mock.calls[0]![0].signal;
  view.rerender(<MotionExportButton source="<h1>Page</h1>" projectId="p" fileName="index.html" title="Page" />);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('button')).toBeNull();
});
