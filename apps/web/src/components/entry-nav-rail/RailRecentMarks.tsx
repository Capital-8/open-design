// Shared rail action marks.

/**
 * The ⋮ mark (supplied artwork; Remix's `more-2-line`). Inlined rather than
 * added to the shared icon set: no `IconName` maps to that glyph today, and
 * this is the only place it appears.
 */
export function MoreDotsMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M12 3C11.175 3 10.5 3.675 10.5 4.5C10.5 5.325 11.175 6 12 6C12.825 6 13.5 5.325 13.5 4.5C13.5 3.675 12.825 3 12 3ZM12 18C11.175 18 10.5 18.675 10.5 19.5C10.5 20.325 11.175 21 12 21C12.825 21 13.5 20.325 13.5 19.5C13.5 18.675 12.825 18 12 18ZM12 10.5C11.175 10.5 10.5 11.175 10.5 12C10.5 12.825 11.175 13.5 12 13.5C12.825 13.5 13.5 12.825 13.5 12C13.5 11.175 12.825 10.5 12 10.5Z" />
    </svg>
  );
}

/**
 * Menu marks (supplied artwork). Inlined for the same reason as the ⋮ above:
 * neither glyph exists in the shared icon set — `pencil`/`trash` are close but
 * not these drawings, and product asked for these.
 */
/** 新建会话's speech-bubble mark for the rail's create row. */
export function NewConversationMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden focusable="false">
      <path d="M2 8.99374C2 5.68349 4.67654 3 8.00066 3H15.9993C19.3134 3 22 5.69478 22 8.99374V21H8.00066C4.68659 21 2 18.3052 2 15.0063V8.99374ZM20 19V8.99374C20 6.79539 18.2049 5 15.9993 5H8.00066C5.78458 5 4 6.78458 4 8.99374V15.0063C4 17.2046 5.79512 19 8.00066 19H20ZM14 11H16V13H14V11ZM8 11H10V13H8V11Z" />
    </svg>
  );
}

export function RenameMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M18.5293 15.3193C18.7058 14.8934 19.2942 14.8934 19.4707 15.3193L19.7236 15.9307C20.1556 16.9735 20.9615 17.8062 21.9746 18.2568L22.6914 18.5762C23.1022 18.7589 23.1022 19.3564 22.6914 19.5391L21.9326 19.877C20.9449 20.3163 20.1534 21.1194 19.7139 22.1279L19.4668 22.6934C19.2863 23.1075 18.7136 23.1075 18.5332 22.6934L18.2861 22.1279C17.8466 21.1194 17.0551 20.3163 16.0674 19.877L15.3076 19.5391C14.8974 19.3562 14.8974 18.759 15.3076 18.5762L16.0254 18.2568C17.0385 17.8062 17.8444 16.9735 18.2764 15.9307L18.5293 15.3193ZM16.4346 3.21193C16.8251 2.82141 17.4591 2.82141 17.8496 3.21193L20.6777 6.04103C21.0681 6.43157 21.0682 7.06464 20.6777 7.45509L7.24219 20.8897H3V16.6475L16.4346 3.21193ZM5 17.4756V18.8897H6.41406L15.7275 9.57618L14.3135 8.16212L5 17.4756ZM15.7275 6.74806L17.1426 8.16212L18.5566 6.74806L17.1426 5.334L15.7275 6.74806Z" />
    </svg>
  );
}

export function DeleteMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M20 7V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V7H2V5H22V7H20ZM6 7V20H18V7H6ZM11 9H13V11H11V9ZM11 12H13V14H11V12ZM11 15H13V17H11V15ZM7 2H17V4H7V2Z" />
    </svg>
  );
}

