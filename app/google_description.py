"""Safely convert Google Calendar's rich-text descriptions into readable plain text.

Google Calendar descriptions may contain HTML from email, imported invitations or
other providers. Never render that markup as HTML in the shared mini app.
"""
from html import unescape
from html.parser import HTMLParser
import re


_MARKUP = re.compile(
    r'</?\s*(?:p|div|br|li|ul|ol|span|strong|b|em|i|u|a|'
    r'h[1-6]|blockquote|pre|table|tbody|tr|td|th|font)\b[^>]*>',
    re.IGNORECASE,
)
_BLOCK = {'p', 'div', 'blockquote', 'pre', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
_HIDDEN = {'script', 'style', 'iframe', 'svg'}


class _PlainDescription(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = []
        self.anchors = []

    def handle_starttag(self, tag, attrs):
        if tag in _HIDDEN:
            self.hidden.append(tag)
            return
        if self.hidden:
            return
        if tag in _BLOCK:
            self.parts.append('\n\n' if tag == 'p' else '\n')
        elif tag == 'br':
            self.parts.append('\n')
        elif tag == 'li':
            self.parts.append('\n• ')
        elif tag == 'a':
            href = dict(attrs).get('href') or ''
            self.anchors.append((href, len(self.parts)))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.hidden:
            if tag == self.hidden[-1]:
                self.hidden.pop()
            return
        if tag in _BLOCK:
            self.parts.append('\n\n' if tag == 'p' else '\n')
        elif tag == 'a' and self.anchors:
            href, index = self.anchors.pop()
            label = ''.join(self.parts[index:]).strip()
            if href.startswith(('https://', 'http://', 'mailto:')) and href not in label:
                self.parts.append(' (' + href + ')')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def google_description_text(value):
    """Strip rich-text tags but preserve paragraphs, meaningful links and text."""
    if not isinstance(value, str) or not value:
        return ''
    candidate = unescape(value) if '&lt;' in value.lower() else value
    if not _MARKUP.search(candidate):
        return value
    parser = _PlainDescription()
    parser.feed(candidate)
    parser.close()
    text = ''.join(parser.parts).replace('\u00a0', ' ')
    text = re.sub(r'[ \t\f\v]+', ' ', text)
    text = re.sub(r'[ \t]*\n[ \t]*', '\n', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()
