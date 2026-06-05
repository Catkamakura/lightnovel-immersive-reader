"""Read & enrich the EPUB's OPF metadata so Calibre-Web-Automated imports it organised.

Maps the LK metadata the reader parses (title / author / translator / LK url / update
time / series+volume / tags) onto Dublin-Core + Calibre OPF fields. CWA reads the OPF on
ingest, so writing the metadata into the file is the clean, calibredb-free path.
"""
from __future__ import annotations
import datetime
import io
import re
import zipfile
from typing import Any
from lxml import etree

OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"
NSMAP = {"opf": OPF_NS, "dc": DC_NS}


def _split_names(v: Any) -> list[str]:
    """A credit like '李雷、悦梦/EMT' is several people → one dc:contributor each (Calibre treats a
    contributor's text as ONE name, so a combined string becomes a single mangled entry)."""
    if not v:
        return []
    return [p.strip() for p in re.split(r"[、，,/／&＆]", str(v)) if p.strip()]


def _find_opf_path(zf: zipfile.ZipFile) -> str:
    try:
        container = etree.fromstring(zf.read("META-INF/container.xml"))
        rf = container.find(f".//{{{CONTAINER_NS}}}rootfile")
        if rf is not None and rf.get("full-path"):
            return rf.get("full-path")
    except Exception:
        pass
    # fallback: first .opf in the archive
    for name in zf.namelist():
        if name.lower().endswith(".opf"):
            return name
    raise ValueError("no OPF found in EPUB")


def _dc(tag: str) -> str:
    return f"{{{DC_NS}}}{tag}"


def _set_text_single(metadata, tag: str, value: str | None, attrib: dict | None = None) -> None:
    """Remove existing dc:<tag> elements and add one with value (if value)."""
    for el in metadata.findall(_dc(tag)):
        metadata.remove(el)
    if value:
        el = etree.SubElement(metadata, _dc(tag))
        el.text = str(value)
        for k, v in (attrib or {}).items():
            el.set(k, v)


def enrich_opf_bytes(opf_bytes: bytes, meta: dict[str, Any]) -> bytes:
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(opf_bytes, parser)
    metadata = root.find(f"{{{OPF_NS}}}metadata")
    if metadata is None:
        metadata = root.find("metadata")
    if metadata is None:
        raise ValueError("OPF has no <metadata>")
    # make sure opf prefix is usable for role/scheme attributes
    role = f"{{{OPF_NS}}}role"
    fileas = f"{{{OPF_NS}}}file-as"
    scheme = f"{{{OPF_NS}}}scheme"

    # EPUB3 vs EPUB2: write roles as <meta refines property="role"> (v3) or opf:role attrs (v2).
    is3 = (root.get("version") or "2.0").strip().startswith("3")
    META = (f"{{{OPF_NS}}}meta", "meta")
    _cid = [0]

    def _metas():
        return [m for m in metadata if m.tag in META]

    def _meta_el(**attrs):
        m = etree.SubElement(metadata, f"{{{OPF_NS}}}meta")
        for k, v in attrs.items():
            m.set(k, v)
        return m

    def _remove_dc_with_refines(tag):
        # remove the dc element AND any <meta refines="#id"> that pointed at it (else a dangling refines = invalid EPUB3)
        ids = set()
        for el in metadata.findall(_dc(tag)):
            if el.get("id"):
                ids.add("#" + el.get("id"))
            metadata.remove(el)
        for m in _metas():
            if m.get("refines") in ids:
                metadata.remove(m)

    def _add_person(tag, name, rel, file_as=None):
        el = etree.SubElement(metadata, _dc(tag)); el.text = str(name)
        if is3:
            pid = f"cr{_cid[0]}"; _cid[0] += 1
            el.set("id", pid)
            r = _meta_el(refines="#" + pid, property="role", scheme="marc:relators"); r.text = rel
            if file_as:
                _meta_el(refines="#" + pid, property="file-as").text = str(file_as)
        else:
            el.set(role, rel)
            if file_as:
                el.set(fileas, str(file_as))

    if meta.get("title"):
        _set_text_single(metadata, "title", meta["title"])
    if meta.get("language"):
        _set_text_single(metadata, "language", meta.get("language") or "zh")

    # author (replace creators) + original author (2nd aut, if distinct) — Calibre's Authors column
    _remove_dc_with_refines("creator")
    if meta.get("author"):
        _add_person("creator", meta["author"], "aut", meta["author"])
    orig = meta.get("original")
    if orig and str(orig) != str(meta.get("author") or ""):
        _add_person("creator", orig, "aut")
    # translator/illustrator/editor/source-group → dc:contributor with MARC relator roles (one per name).
    # Calibre surfaces edt + bkp natively; trl/ill round-trip (invisible) but also get a tag below.
    _remove_dc_with_refines("contributor")
    for key, rel in (("translator", "trl"), ("illustrator", "ill"), ("editor", "edt"), ("sourceGroup", "bkp")):
        for name in _split_names(meta.get(key)):
            _add_person("contributor", name, rel)

    if meta.get("updated"):
        _set_text_single(metadata, "date", str(meta["updated"]))
    if meta.get("lkUrl"):
        _set_text_single(metadata, "source", str(meta["lkUrl"]))

    # comments / description
    desc = meta.get("description")
    if desc:
        _set_text_single(metadata, "description", str(desc))

    # tags → subjects (replace ours), plus searchable fallback tags for credits Calibre has no native column for
    for el in metadata.findall(_dc("subject")):
        metadata.remove(el)
    subjects = list(meta.get("tags") or [])
    for lbl, key in (("译者", "translator"), ("插画", "illustrator"), ("图源", "sourceGroup")):
        if meta.get(key):
            subjects.append(f"{lbl}:{meta[key]}")
    for tag in subjects:
        s = etree.SubElement(metadata, _dc("subject")); s.text = str(tag)

    # identifiers: keep the package unique id, add lknovel + url (Calibre reads these as identifiers)
    pkg_id_attr = root.get("unique-identifier")
    for el in metadata.findall(_dc("identifier")):
        if el.get("id") == pkg_id_attr:
            continue  # never remove the package unique-identifier
        if (el.get(scheme) or "").lower() in {"lknovel", "url"}:
            metadata.remove(el)  # drop our previously-added ones so re-import stays clean
    # only add a scheme if it isn't already present (the package id may itself carry one) → idempotent
    present = {(el.get(scheme) or "").lower() for el in metadata.findall(_dc("identifier"))}
    if meta.get("aid") and "lknovel" not in present:
        i = etree.SubElement(metadata, _dc("identifier")); i.set(scheme, "lknovel"); i.text = str(meta["aid"])
    if meta.get("lkUrl") and "url" not in present:
        i = etree.SubElement(metadata, _dc("identifier")); i.set(scheme, "url"); i.text = str(meta["lkUrl"])

    # series: Calibre OPF2 meta (both versions) + EPUB3 belongs-to-collection (v3). Wipe old ones first.
    for m in _metas():
        if m.get("name") in {"calibre:series", "calibre:series_index"} \
           or m.get("property") in {"belongs-to-collection", "collection-type", "group-position"}:
            metadata.remove(m)
    if meta.get("series"):
        ser = str(meta["series"]); vol = meta.get("volume")
        vi = None
        if vol is not None:
            try:
                vi = float(vol)
            except (TypeError, ValueError):
                vi = None
        if is3:
            cid = f"col{_cid[0]}"; _cid[0] += 1
            _meta_el(property="belongs-to-collection", id=cid).text = ser
            _meta_el(refines="#" + cid, property="collection-type").text = "series"
            if vi is not None:
                _meta_el(refines="#" + cid, property="group-position").text = ("%g" % vi)
        _meta_el(name="calibre:series", content=ser)
        if vi is not None:
            _meta_el(name="calibre:series_index", content=("%g" % vi))

    # EPUB3 release identifier: (re)set the required dcterms:modified
    if is3:
        for m in _metas():
            if m.get("property") == "dcterms:modified":
                metadata.remove(m)
        _meta_el(property="dcterms:modified").text = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return etree.tostring(root, xml_declaration=True, encoding="utf-8", standalone=False)


def enrich_epub(epub_bytes: bytes, meta: dict[str, Any]) -> bytes:
    """Return a new EPUB (bytes) with the OPF metadata enriched; mimetype stays first/stored."""
    src = zipfile.ZipFile(io.BytesIO(epub_bytes), "r")
    opf_path = _find_opf_path(src)
    new_opf = enrich_opf_bytes(src.read(opf_path), meta)

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        # mimetype MUST be first and stored uncompressed
        names = src.namelist()
        if "mimetype" in names:
            dst.writestr(zipfile.ZipInfo("mimetype"), src.read("mimetype"), compress_type=zipfile.ZIP_STORED)
        for name in names:
            if name == "mimetype":
                continue
            data = new_opf if name == opf_path else src.read(name)
            dst.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
    src.close()
    return out.getvalue()
