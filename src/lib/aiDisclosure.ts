const AI_DISCLOSURE_KEY = "suppliersync-ai-disclosure-seen";

const AI_DISCLOSURE_MESSAGE =
  "Documents are processed by OpenAI to extract fields from PDFs. PDF content is sent to OpenAI's API for this feature. Do not upload protected health information unless you have appropriate agreements in place. Continue?";

export function acknowledgeAiDisclosureIfNeeded(): boolean {
  if (localStorage.getItem(AI_DISCLOSURE_KEY) === "1") return true;
  const accepted = window.confirm(AI_DISCLOSURE_MESSAGE);
  if (accepted) localStorage.setItem(AI_DISCLOSURE_KEY, "1");
  return accepted;
}
