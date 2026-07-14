const HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}
