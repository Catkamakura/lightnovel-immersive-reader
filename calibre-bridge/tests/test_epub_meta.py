import io
import zipfile
from lxml import etree

from bridge.epub_meta import enrich_epub, enrich_opf_bytes, _find_opf_path
from conftest import make_epub

OPF = "{http://www.idpf.org/2007/opf}"
DC = "{http://purl.org/dc/elements/1.1/}"

META = {
    "aid": "1144697", "lkUrl": "https://www.lightnovel.fun/detail/1144697",
    "title": "浮游学园的爱丽丝&雪莉", "author": "むらさきゆきや", "translator": "夜殇",
    "updated": "2014-03-02", "series": "浮游学园的爱丽丝&雪莉", "volume": 2,
    "tags": ["轻小说", "校园"], "language": "zh", "description": "测试简介",
}


def _opf_tree(epub_bytes):
    zf = zipfile.ZipFile(io.BytesIO(epub_bytes))
    opf = zf.read(_find_opf_path(zf))
    return etree.fromstring(opf)


def test_enrich_sets_all_fields():
    out = enrich_epub(make_epub(), META)
    root = _opf_tree(out)
    DC = "{http://purl.org/dc/elements/1.1/}"
    OPF = "{http://www.idpf.org/2007/opf}"
    meta = root.find(f"{OPF}metadata")

    assert meta.find(f"{DC}title").text == "浮游学园的爱丽丝&雪莉"
    creator = meta.find(f"{DC}creator")
    assert creator.text == "むらさきゆきや" and creator.get(f"{OPF}role") == "aut"
    contributor = meta.find(f"{DC}contributor")
    assert contributor.text == "夜殇" and contributor.get(f"{OPF}role") == "trl"

    ids = {(e.get(f"{OPF}scheme") or "").lower(): e.text for e in meta.findall(f"{DC}identifier")}
    assert ids.get("lknovel") == "1144697"
    assert ids.get("url") == "https://www.lightnovel.fun/detail/1144697"

    subjects = [e.text for e in meta.findall(f"{DC}subject")]
    assert "校园" in subjects and "轻小说" in subjects
    assert "译者:夜殇" in subjects   # searchable tag fallback for the (Calibre-invisible) translator role

    metas = {m.get("name"): m.get("content") for m in meta.findall(f"{OPF}meta")}
    assert metas.get("calibre:series") == "浮游学园的爱丽丝&雪莉"
    assert metas.get("calibre:series_index") == "2"

    assert meta.find(f"{DC}date").text == "2014-03-02"
    assert meta.find(f"{DC}source").text.endswith("/1144697")


def test_full_credit_set_with_roles_and_multivalue():
    meta = {
        "aid": "1", "title": "书", "author": "嬉野秋彦", "original": "原作者X",
        "translator": "李雷、悦梦/EMT", "illustrator": "潮崎しの", "editor": "校对君",
        "sourceGroup": "暗影突击鹅", "series": "书", "volume": 9, "tags": ["轻小说"],
    }
    root = _opf_tree(enrich_epub(make_epub(), meta))
    DC = "{http://purl.org/dc/elements/1.1/}"; OPF = "{http://www.idpf.org/2007/opf}"
    md = root.find(f"{OPF}metadata")
    # two aut creators: the author + the distinct original author
    creators = [(e.text, e.get(f"{OPF}role")) for e in md.findall(f"{DC}creator")]
    assert ("嬉野秋彦", "aut") in creators and ("原作者X", "aut") in creators
    # contributors carry the right MARC roles; multi-name translator is split into 3 elements
    contribs = [(e.text, e.get(f"{OPF}role")) for e in md.findall(f"{DC}contributor")]
    assert ("李雷", "trl") in contribs and ("悦梦", "trl") in contribs and ("EMT", "trl") in contribs
    assert ("潮崎しの", "ill") in contribs
    assert ("校对君", "edt") in contribs           # editor → edt (Calibre-native)
    assert ("暗影突击鹅", "bkp") in contribs        # scanlation/source group → bkp (Book producer, Calibre-native)
    # searchable tag fallbacks for the invisible roles
    subjects = [e.text for e in md.findall(f"{DC}subject")]
    assert "译者:李雷、悦梦/EMT" in subjects and "插画:潮崎しの" in subjects and "图源:暗影突击鹅" in subjects


def test_epub3_uses_refines_roles_and_cleans_dangling():
    # an EPUB3 OPF whose creator already carries a refines role (like our buildEpub output)
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookID">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="BookID">urn:uuid:1</dc:identifier>'
        '<dc:title>old</dc:title><dc:language>zh</dc:language>'
        '<dc:creator id="c0">OldAuthor</dc:creator>'
        '<meta refines="#c0" property="role" scheme="marc:relators">aut</meta>'
        '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>'
        '</metadata><manifest><item id="n" href="n.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>'
        '<spine><itemref idref="n"/></spine></package>'
    )
    meta = {"aid": "1", "title": "书", "author": "嬉野秋彦", "original": "原作X",
            "translator": "李雷、悦梦", "illustrator": "潮崎しの", "editor": "校对君",
            "sourceGroup": "暗影鹅", "series": "书", "volume": 9, "tags": ["轻小说"]}
    root = etree.fromstring(enrich_opf_bytes(opf.encode(), meta))
    md = root.find(f"{OPF}metadata")
    metas = md.findall(f"{OPF}meta")

    # roles are written as refines, NOT opf:role attributes
    assert all(c.get(f"{OPF}role") is None for c in md.findall(f"{DC}creator"))
    # NO dangling refines: every refines="#id" points at an element that still has that id
    ids = {e.get("id") for e in md.iter() if e.get("id")}
    for m in metas:
        ref = m.get("refines")
        assert ref is None or ref[1:] in ids, f"dangling refines {ref}"
    roles = [m.text for m in metas if m.get("property") == "role"]
    assert roles.count("aut") == 2 and {"trl", "ill", "edt", "bkp"} <= set(roles)
    assert roles.count("trl") == 2   # 李雷、悦梦 split into two contributors
    # EPUB3 series + refreshed release identifier
    assert any(m.get("property") == "belongs-to-collection" and m.text == "书" for m in metas)
    assert any(m.get("name") == "calibre:series" for m in metas)   # Calibre OPF2 form kept too
    mod = [m.text for m in metas if m.get("property") == "dcterms:modified"]
    assert len(mod) == 1 and mod[0] != "2020-01-01T00:00:00Z"


def test_original_equal_author_no_duplicate():
    root = _opf_tree(enrich_epub(make_epub(), {"aid": "1", "title": "t", "author": "同人", "original": "同人"}))
    OPF = "{http://www.idpf.org/2007/opf}"; DC = "{http://purl.org/dc/elements/1.1/}"
    creators = root.find(f"{OPF}metadata").findall(f"{DC}creator")
    assert len(creators) == 1   # original == author → no duplicate creator


def test_mimetype_first_and_stored():
    out = enrich_epub(make_epub(), META)
    zf = zipfile.ZipFile(io.BytesIO(out))
    names = zf.namelist()
    assert names[0] == "mimetype"
    assert zf.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
    assert zf.read("mimetype") == b"application/epub+zip"


def test_no_duplicate_when_package_id_carries_scheme():
    # an EPUB whose unique-identifier element ITSELF carries opf:scheme="lknovel" must not get a 2nd one
    opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookID">'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">'
           '<dc:identifier id="BookID" opf:scheme="lknovel">1144697</dc:identifier><dc:title>t</dc:title>'
           '</metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>'
           '<spine><itemref idref="c"/></spine></package>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), b"application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("content.opf", opf)
        z.writestr("c.xhtml", "<html/>")
    root = _opf_tree(enrich_epub(out.getvalue(), META))
    DC = "{http://purl.org/dc/elements/1.1/}"; OPF = "{http://www.idpf.org/2007/opf}"
    meta = root.find(f"{OPF}metadata")
    lknovel = [e for e in meta.findall(f"{DC}identifier") if (e.get(f"{OPF}scheme") or "").lower() == "lknovel"]
    assert len(lknovel) == 1


def test_idempotent_reimport():
    # enriching twice must not duplicate identifiers/series meta
    once = enrich_epub(make_epub(), META)
    twice = enrich_epub(once, META)
    root = _opf_tree(twice)
    DC = "{http://purl.org/dc/elements/1.1/}"
    OPF = "{http://www.idpf.org/2007/opf}"
    meta = root.find(f"{OPF}metadata")
    lknovel = [e for e in meta.findall(f"{DC}identifier") if (e.get(f"{OPF}scheme") or "").lower() == "lknovel"]
    series = [m for m in meta.findall(f"{OPF}meta") if m.get("name") == "calibre:series"]
    assert len(lknovel) == 1
    assert len(series) == 1
    # package unique-identifier preserved
    assert any(e.get("id") == "BookID" for e in meta.findall(f"{DC}identifier"))
