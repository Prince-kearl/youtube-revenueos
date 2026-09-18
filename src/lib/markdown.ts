import { marked } from "marked";
import DOMPurify from "dompurify";

// AI-generated freebie content can be influenced by uploaded Knowledge Base files, which are real
// user input — sanitize before it ever reaches dangerouslySetInnerHTML on the public /f/$slug page.
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(html);
}
