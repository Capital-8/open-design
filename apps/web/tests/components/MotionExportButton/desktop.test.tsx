// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MotionExportButton } from '../../../src/components/MotionExportButton/Desktop';

afterEach(cleanup);
it('does not expose an unsupported MP4 operation even for motion content', () => {
  render(<MotionExportButton projectId="p" fileName="index.html" title="Film" source='<main data-composition-id="main" data-duration="2">Motion</main>' />);
  expect(screen.queryByRole('button')).toBeNull();
});
