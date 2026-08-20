export const DRAWER_WIDTH = 680;

/**
 * What the picker accepts. A `.zip` is opened for its Markdown entries only —
 * every other entry comes back in `skipped_files`, unread and unexecuted.
 */
export const SUPPORTED_EXTENSIONS = [".md", ".markdown", ".zip"] as const;

/** `accept` attribute for the file input, derived from the same list. */
export const FILE_ACCEPT = SUPPORTED_EXTENSIONS.join(",");
