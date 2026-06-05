import io
import zipfile


def make_epub(title="原始标题", author="orig", with_series=False) -> bytes:
    """A minimal valid EPUB (mimetype first/stored) for tests."""
    container = (
        '<?xml version="1.0"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
        '</container>'
    )
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookID">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">'
        f'<dc:identifier id="BookID">urn:uuid:abc-123</dc:identifier>'
        f'<dc:title>{title}</dc:title>'
        f'<dc:creator opf:role="aut">{author}</dc:creator>'
        '<dc:language>zh</dc:language>'
        '</metadata>'
        '<manifest>'
        '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
        '</manifest>'
        '<spine><itemref idref="ch1"/></spine>'
        '</package>'
    )
    ch1 = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p></body></html>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), b"application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/ch1.xhtml", ch1, compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()
