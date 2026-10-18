import pytest

from app.google_description import google_description_text


@pytest.mark.parametrize('raw,expected',[
    ('<p>Участие подтверждено. Контакт: biuro@example.com</p>',
     'Участие подтверждено. Контакт: biuro@example.com'),
    ('<p>KLM Cityhopper, KL1338 &amp; Embraer 190<br>Economy</p>',
     'KLM Cityhopper, KL1338 & Embraer 190\nEconomy'),
    ('<p>First</p><p>Second</p>', 'First\n\nSecond'),
    ('<div>Flight <b>information</b></div>', 'Flight information'),
    ('<ul><li>One</li><li>Two</li></ul>', '• One\n• Two'),
    ('<p>RSVP via <a href="https://example.org/rsvp">the form</a>.</p>',
     'RSVP via the form (https://example.org/rsvp).'),
    ('<p>Hello&nbsp;world &lt;3</p>', 'Hello world <3'),
    ('&lt;p&gt;Escaped tags&lt;/p&gt;', 'Escaped tags'),
    ('<p>Text<script>alert(1)</script><style>body{display:none}</style> is safe</p>',
     'Text is safe'),
    ('Already plain\nTwo lines', 'Already plain\nTwo lines'),
    ('A &amp; B should stay unchanged if Google sent plain text', 
     'A &amp; B should stay unchanged if Google sent plain text'),
    ('1 < 2 and 3 > 1', '1 < 2 and 3 > 1'),
])
def test_google_description_to_plain_text(raw, expected):
    assert google_description_text(raw) == expected


def test_empty_google_description():
    assert google_description_text(None) == ''
    assert google_description_text('') == ''
