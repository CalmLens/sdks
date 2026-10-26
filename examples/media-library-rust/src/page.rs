//! Server-rendered HTML with no JavaScript or external assets. Every dynamic value goes through
//! [`h`]. Dialogs (upload, new folder, folder settings, edit, move, remove and delete) are native
//! HTML popovers opened by `popovertarget` buttons, so they need no script.
use crate::app::{
    catalogue_id, category_label, content_removed, decision, deliverable, flagged_categories, href,
    latest_review, metadata_value, Decision, PageContext, View, LICENCES, MAX_CATALOGUE_ID,
    MAX_DESCRIPTION, MAX_FOLDER_NAME, MAX_META, MAX_NAME, MAX_QUERY, META_CAMPAIGN, META_LICENCE,
    META_PHOTOGRAPHER, SEARCH_MODES, STATUS_FILTERS,
};
use crate::demo::DEMO_OUTCOMES;
use calmlens::models::{Asset, AssetContentRemovalReason, Folder, SearchMatchField};
use std::collections::HashSet;
use std::fmt::Write;
use std::time::UNIX_EPOCH;

const STYLE: &str = "
:root{--ink:#1d2327;--muted:#5d666d;--line:#e2e5e8;--soft:#f4f5f6;--panel:#fff;--accent:#1f6a64;--accent-ink:#fff;--accent-soft:#e3f0ee;--danger:#a3362c;
--ok-bg:#e2f1e7;--ok:#22603a;--wait-bg:#e6edf6;--wait:#2c4f7c;--warn-bg:#fbf0d6;--warn:#6d5212;--bad-bg:#f9e3e0;--bad:#8f2f26;--off-bg:#eceef0;--off:#4b535a;
font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--soft);line-height:1.45;font-size:14px}
*{box-sizing:border-box}body{margin:0}a{color:inherit}h1,h2,h3{margin:0;line-height:1.25}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.appbar{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16px;text-decoration:none;min-width:212px}.brand svg{flex:none}
.search{flex:1;display:flex;gap:6px;max-width:640px}.search input{flex:1}.search select{width:auto}
.appbar .end{margin-left:auto;display:flex;gap:8px;align-items:center}
.tag{display:inline-block;border-radius:5px;padding:1px 7px;font-size:12px;font-weight:600;background:var(--off-bg);color:var(--off);white-space:nowrap}
input,select,textarea,button,.button{font:inherit;color:inherit}
input,select,textarea{border:1px solid #cfd4d8;border-radius:7px;padding:7px 10px;background:#fff;width:100%}textarea{min-height:76px;resize:vertical}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #cfd4d8;background:#fff;border-radius:7px;padding:7px 12px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
button:hover,.button:hover{background:var(--soft)}
.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}.primary:hover{background:#18554f}
.danger{color:var(--danger)}.danger.solid{background:var(--danger);border-color:var(--danger);color:#fff}
.quiet{border-color:transparent;background:transparent;padding:5px 8px}.quiet:hover{background:var(--soft)}
.notice{margin:12px 20px 0;padding:10px 14px;border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--panel);border-radius:7px}.notice code{font-size:12px;background:var(--soft);padding:1px 5px;border-radius:4px}
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:calc(100vh - 57px)}.shell.with-detail{grid-template-columns:232px minmax(0,1fr) 340px}
.sidebar{border-right:1px solid var(--line);background:var(--panel);padding:16px 12px}
.side-head{display:flex;align-items:center;justify-content:space-between;padding:0 6px 6px}.side-head h2,.section-title{font-size:12px;font-weight:600;color:var(--muted)}
.tree,.tree ul{list-style:none;margin:0;padding:0}.tree ul{padding-left:14px}
.tree a{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;text-decoration:none;overflow-wrap:anywhere}.tree a:hover{background:var(--soft)}
.tree a[aria-current]{background:var(--accent-soft);color:#14453f;font-weight:600}.tree svg{flex:none;color:var(--muted)}
.activity{margin-top:22px;padding:0 6px}.activity ol{list-style:none;margin:8px 0 0;padding:0}.activity li{padding:7px 0;border-top:1px solid var(--line);font-size:12.5px}
.activity time{display:block;color:var(--muted);font-size:11.5px}.activity dl{margin-top:3px;font-size:11.5px;color:var(--muted)}
.content{padding:18px 24px 28px;min-width:0}
.titlebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.titlebar h1{font-size:20px}.crumbs{color:var(--muted);font-size:13px;margin-bottom:2px}.crumbs a{text-decoration:none}.crumbs a:hover{text-decoration:underline}
.count{color:var(--muted);font-weight:400}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 16px}.filters a{padding:4px 10px;border-radius:20px;border:1px solid var(--line);background:var(--panel);text-decoration:none;font-size:13px}
.filters a[aria-current]{background:var(--ink);border-color:var(--ink);color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:16px}
.card{display:block;text-decoration:none;border-radius:9px;padding:6px;margin:-6px}.card:hover{background:#e9ecee}.card[aria-current]{background:var(--accent-soft);box-shadow:inset 0 0 0 2px var(--accent)}
.thumb{position:relative;aspect-ratio:4/3;border-radius:7px;overflow:hidden;background:#dde1e4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;padding:10px;color:var(--off)}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.thumb .tag{position:absolute;left:7px;top:7px}.thumb.state{border:1px dashed #c3c9ce;background:#eef0f2}.thumb strong{font-size:13px}.thumb small{font-size:12px;color:var(--muted)}
.thumb.bad{background:#f8eeec;border-color:#e5c3be;color:var(--bad)}.thumb.wait{background:#edf2f8;border-color:#c5d3e5;color:var(--wait)}.thumb.warn{background:#fbf5e6;border-color:#e8d8ac;color:var(--warn)}
.card .name{display:block;font-weight:600;margin-top:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.card .sub{display:block;color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.allowed{background:var(--ok-bg);color:var(--ok)}.pending{background:var(--wait-bg);color:var(--wait)}.restricted{background:var(--warn-bg);color:var(--warn)}.blocked{background:var(--bad-bg);color:var(--bad)}.error{background:var(--warn-bg);color:var(--warn)}.removed{background:var(--off-bg);color:var(--off)}
.empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:56px 16px;border:1px dashed #cfd4d8;border-radius:9px}
.pager{display:flex;justify-content:space-between;margin-top:20px}
.detail{border-left:1px solid var(--line);background:var(--panel);padding:16px 18px 28px;min-width:0}
.detail-head{display:flex;align-items:center;gap:8px}.detail-head h2{font-size:16px;flex:1;overflow-wrap:anywhere}
.preview{margin-top:12px;aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:#dde1e4;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center;padding:16px}.preview img{width:100%;height:100%;object-fit:cover;display:block}.preview.has-image{padding:0}
.status{margin-top:12px;padding:10px 12px;border-radius:8px;background:var(--soft)}.status p{margin:4px 0 0;color:var(--muted);font-size:13px}.status p strong{color:var(--ink);font-weight:600}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.actions .grow{flex:1}
.hint{color:var(--muted);font-size:12.5px;margin:6px 0 0}
dl.props{display:grid;grid-template-columns:96px minmax(0,1fr);gap:7px 10px;margin:16px 0 0;font-size:13px}dl.props dt{color:var(--muted)}dl.props dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}.chips{display:flex;flex-wrap:wrap;gap:4px}
.history{list-style:none;margin:8px 0 0;padding:0}.history li{position:relative;padding:0 0 10px 16px;font-size:13px}.history li::before{content:'';position:absolute;left:3px;top:6px;width:7px;height:7px;border-radius:50%;background:#aab3ba}
.history li:not(:last-child)::after{content:'';position:absolute;left:6px;top:15px;bottom:0;width:1px;background:var(--line)}.history time{display:block;color:var(--muted);font-size:12px}
section.block{margin-top:20px;border-top:1px solid var(--line);padding-top:14px}
[popover]{border:1px solid var(--line);border-radius:12px;padding:20px;width:min(440px,calc(100vw - 32px));box-shadow:0 18px 50px rgba(20,30,35,.18);color:var(--ink)}
[popover]::backdrop{background:rgba(20,28,32,.32)}[popover] h2{font-size:16px;margin-bottom:4px}
[popover] label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}[popover] label small{font-weight:400;color:var(--muted)}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
input[type=file]{padding:18px 12px;border-style:dashed;background:var(--soft)}input[type=file]::file-selector-button{font:inherit;font-weight:600;border:1px solid #cfd4d8;background:#fff;border-radius:6px;padding:5px 10px;margin-right:10px;cursor:pointer}
.matched{display:block;color:var(--muted);font-size:12px}
@media(max-width:1100px){.shell.with-detail{grid-template-columns:232px minmax(0,1fr)}.detail{grid-column:1/-1;border-left:0;border-top:1px solid var(--line)}}
@media(max-width:760px){.shell,.shell.with-detail{grid-template-columns:1fr}.sidebar{border-right:0;border-bottom:1px solid var(--line)}.appbar{flex-wrap:wrap}.brand{min-width:0}.search{order:3;flex-basis:100%;max-width:none}.content{padding:16px}}
";

const LOGO: &str = r##"<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="5" fill="#1f6a64"/><rect x="5" y="5" width="5" height="5" rx="1.2" fill="#fff"/><rect x="12" y="5" width="5" height="5" rx="1.2" fill="#fff" opacity=".7"/><rect x="5" y="12" width="5" height="5" rx="1.2" fill="#fff" opacity=".7"/><rect x="12" y="12" width="5" height="5" rx="1.2" fill="#fff"/></svg>"##;
const FOLDER_ICON: &str = r#"<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h3.4l1.5 1.6h5.7c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>"#;
const STACK_ICON: &str = r#"<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 10l3.5-3 3 2.5L11 7l3 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>"#;

pub(crate) fn render(app: &PageContext, view: &View) -> String {
    let mut html = String::with_capacity(24 * 1024);
    let csrf = format!(
        r#"<input type="hidden" name="csrf" value="{}">"#,
        h(&app.csrf)
    );
    let current = view.query.folder.as_deref();
    let _ = write!(
        html,
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calmlibrary</title><style>{STYLE}</style></head><body><header class="appbar"><a class="brand" href="/">{LOGO}Calmlibrary</a>"#
    );
    if !view.unavailable {
        let _ = write!(
            html,
            r#"<form class="search" action="/" method="get" role="search"><input id="q" name="q" type="search" aria-label="Search the library" maxlength="{MAX_QUERY}" value="{}" placeholder="Describe an image, e.g. tomatoes on the vine"><select id="mode" name="mode" aria-label="Search mode">{}</select><button type="submit">Search</button></form>"#,
            h(&view.query.search),
            options(&SEARCH_MODES, view.query.mode)
        );
    }
    html.push_str(r#"<div class="end">"#);
    if app.demo {
        html.push_str(r#"<span class="tag" title="The library lives in memory and moderation outcomes are chosen at upload.">Demo library</span>"#);
    }
    if !view.unavailable {
        html.push_str(r#"<button class="primary" type="button" popovertarget="upload-dialog">Upload</button>"#);
    }
    html.push_str("</div></header>");
    if let Some(notice) = &view.notice {
        let _ = write!(
            html,
            r#"<p class="notice" role="status">{}"#,
            h(&notice.message)
        );
        if let Some(code) = &notice.code {
            let _ = write!(html, " <code>{}</code>", h(code));
        }
        html.push_str("</p>");
    }
    if view.unavailable {
        html.push_str("</body></html>");
        return html;
    }
    let paths = folder_paths(&view.folders);

    // ------------------------------------------------------------ sidebar
    let _ = write!(
        html,
        r#"<div class="shell{}"><nav class="sidebar" aria-labelledby="folders"><div class="side-head"><h2 id="folders">Folders</h2><button class="quiet" type="button" popovertarget="folder-dialog" aria-label="New folder" title="New folder">+ New</button></div><ul class="tree">"#,
        if view.selected.is_some() {
            " with-detail"
        } else {
            ""
        }
    );
    let _ = write!(
        html,
        r#"<li><a href="/"{}>{STACK_ICON}All assets</a></li>"#,
        if current.is_none() && view.query.search.is_empty() {
            r#" aria-current="page""#
        } else {
            ""
        }
    );
    tree(&mut html, &view.folders, None, current, &mut HashSet::new());
    html.push_str("</ul>");
    activity(&mut html, app);
    html.push_str(r#"</nav><main class="content">"#);

    // ------------------------------------------------------------ search results
    if let Some(results) = &view.search {
        let _ = write!(
            html,
            r#"<div class="crumbs"><a href="/">All assets</a></div><div class="titlebar"><h1>Results for “{}” <span class="count">{}</span></h1><span class="tag" title="Semantic search status" data-semantic-status="{status}">Semantic: {status}</span>"#,
            h(&results.query),
            results.items.len(),
            status = h(results.semantic_status.as_str())
        );
        if app.demo {
            html.push_str(r#"<span class="tag" title="Demo search matches keywords in names, descriptions, tags and metadata.">Simulated</span>"#);
        }
        html.push_str(r#"</div><p class="hint">Blocked, purged, unfinished and removed images never appear in search.</p><div class="grid" style="margin-top:16px">"#);
        if results.items.is_empty() {
            html.push_str(r#"<p class="empty">No images match that description.</p>"#);
        }
        for item in &results.items {
            card(
                &mut html,
                &item.asset,
                &[("q", view.query.search.as_str()), ("mode", view.query.mode)],
                view.query.asset.as_deref(),
            );
            let _ = write!(
                html,
                r#"<span class="matched">Matched <span data-matched-fields="{fields}">{fields}</span> · {:.0}%</span></a>"#,
                item.score * 100.0,
                fields = h(&item
                    .matched_fields
                    .iter()
                    .map(SearchMatchField::as_str)
                    .collect::<Vec<_>>()
                    .join(", "))
            );
        }
        html.push_str("</div>");
    }

    // ------------------------------------------------------------ folder listing
    if let Some(listing) = &view.listing {
        let folder = current.and_then(|id| view.folders.iter().find(|folder| folder.id == id));
        html.push_str(r#"<div class="crumbs">"#);
        if let Some(folder) = folder {
            html.push_str(r#"<a href="/">All assets</a>"#);
            for ancestor in ancestors(&view.folders, folder).iter().rev() {
                let _ = write!(
                    html,
                    r#" / <a href="{}">{}</a>"#,
                    h(&href(&[("folder", ancestor.id.as_str())])),
                    h(ancestor.name.as_deref().unwrap_or("Untitled"))
                );
            }
        }
        let _ = write!(
            html,
            r#"</div><div class="titlebar"><h1>{}</h1>"#,
            h(folder
                .and_then(|folder| folder.name.as_deref())
                .unwrap_or("All assets"))
        );
        if folder.is_some() {
            html.push_str(r#"<button class="quiet" type="button" popovertarget="folder-settings">Folder settings</button>"#);
        }
        html.push_str(r#"</div><nav class="filters" aria-label="Status">"#);
        for (value, label) in STATUS_FILTERS {
            let mut pairs = vec![];
            if let Some(id) = current {
                pairs.push(("folder", id));
            }
            if !value.is_empty() {
                pairs.push(("status", value));
            }
            let _ = write!(
                html,
                r#"<a href="{}"{}>{}</a>"#,
                h(&href(&pairs)),
                if view.query.status == value {
                    r#" aria-current="true""#
                } else {
                    ""
                },
                h(label)
            );
        }
        html.push_str(r#"</nav><div class="grid">"#);
        if listing.items.is_empty() {
            html.push_str(if view.query.status.is_empty() {
                r#"<p class="empty">No images here yet. Upload one to add it to this folder.</p>"#
            } else {
                r#"<p class="empty">No images with this status.</p>"#
            });
        }
        let mut keep = vec![];
        if let Some(id) = current {
            keep.push(("folder", id));
        }
        if !view.query.status.is_empty() {
            keep.push(("status", view.query.status));
        }
        for asset in &listing.items {
            card(&mut html, asset, &keep, view.query.asset.as_deref());
            html.push_str("</a>");
        }
        html.push_str("</div>");
        let link = |cursor: Option<&str>| {
            let mut pairs = vec![];
            if let Some(cursor) = cursor {
                pairs.push(("cursor", cursor));
            }
            pairs.extend(keep.iter().copied());
            href(&pairs)
        };
        if view.query.cursor.is_some() || listing.next_cursor.is_some() {
            html.push_str(r#"<nav class="pager" aria-label="Pages"><span>"#);
            if view.query.cursor.is_some() {
                let _ = write!(
                    html,
                    r#"<a class="button" href="{}">First page</a>"#,
                    h(&link(None))
                );
            }
            html.push_str("</span><span>");
            if let Some(cursor) = listing.next_cursor.as_deref() {
                let _ = write!(
                    html,
                    r#"<a class="button" href="{}">Next page</a>"#,
                    h(&link(Some(cursor)))
                );
            }
            html.push_str("</span></nav>");
        }
        if let Some(folder) = folder {
            folder_settings(&mut html, folder, &paths, &csrf);
        }
    }
    html.push_str("</main>");

    // ------------------------------------------------------------ selected asset
    if let Some(asset) = &view.selected {
        detail(&mut html, app, view, asset, &paths, &csrf);
    }
    html.push_str("</div>");

    // ------------------------------------------------------------ dialogs
    let _ = write!(
        html,
        r#"<div id="folder-dialog" popover><form action="/folders" method="post">{csrf}<h2>New folder</h2><label for="folder-name">Name</label><input id="folder-name" name="name" required maxlength="{MAX_FOLDER_NAME}" placeholder="e.g. Spring campaign"><label for="folder-parent">Inside</label>{}<div class="dialog-actions"><button type="button" popovertarget="folder-dialog" popovertargetaction="hide">Cancel</button><button class="primary" type="submit">Create folder</button></div></form></div>"#,
        folder_select(
            "folder-parent",
            "parent",
            &paths,
            current,
            "Library (top level)"
        )
    );
    let _ = write!(
        html,
        r#"<div id="upload-dialog" popover><form action="/assets" method="post" enctype="multipart/form-data">{csrf}<h2>Upload an image</h2><p class="hint">JPEG, PNG, GIF or WebP up to 5MiB. Images stay private and appear once they are checked.</p><label for="file">Image</label><input id="file" name="file" type="file" required accept="image/jpeg,image/png,image/gif,image/webp"><div class="row"><div><label for="upload-name">Name <small>(optional)</small></label><input id="upload-name" name="name" maxlength="{MAX_NAME}"></div><div><label for="external-id">Catalogue ID <small>(optional)</small></label><input id="external-id" name="external_id" class="mono" maxlength="{MAX_CATALOGUE_ID}" pattern="[A-Za-z0-9._:\-]+" placeholder="CAM-2026-014"></div></div><label for="upload-folder">Folder</label>{}<label for="upload-description">Description</label><textarea id="upload-description" name="description" maxlength="{MAX_DESCRIPTION}"></textarea>{}"#,
        folder_select(
            "upload-folder",
            "folder",
            &paths,
            current,
            "Library (top level)"
        ),
        metadata_inputs("upload", None)
    );
    if app.demo {
        html.push_str(r#"<label for="demo-outcome">Demo moderation outcome</label><select id="demo-outcome" name="demo_outcome">"#);
        for (value, label) in DEMO_OUTCOMES {
            let _ = write!(
                html,
                r#"<option value="{}">{}</option>"#,
                h(value),
                h(label)
            );
        }
        html.push_str("</select>");
    }
    html.push_str(r#"<div class="dialog-actions"><button type="button" popovertarget="upload-dialog" popovertargetaction="hide">Cancel</button><button class="primary" type="submit">Upload</button></div></form></div></body></html>"#);
    html
}

fn activity(html: &mut String, app: &PageContext) {
    html.push_str(r#"<section class="activity" aria-labelledby="activity"><h2 id="activity" class="section-title">Activity</h2>"#);
    if app.activity.is_empty() {
        let _ = write!(
            html,
            r#"<p class="hint">{}</p>"#,
            if app.webhooks_enabled {
                "Uploads, changes and moderation decisions appear here."
            } else {
                "Uploads and changes appear here. Set CALMLENS_WEBHOOK_SECRET to receive moderation decisions."
            }
        );
    } else {
        html.push_str("<ol>");
        for entry in app.activity.iter().take(6) {
            let seconds = entry
                .at
                .duration_since(UNIX_EPOCH)
                .map(|time| time.as_secs())
                .unwrap_or(0)
                % 86_400;
            let _ = write!(
                html,
                "<li><time>{:02}:{:02} UTC</time>{}",
                seconds / 3600,
                seconds / 60 % 60,
                h(&entry.text)
            );
            if !entry.facts.is_empty() {
                html.push_str(r#"<dl class="props" style="grid-template-columns:auto 1fr;gap:1px 8px;margin-top:3px">"#);
                for fact in &entry.facts {
                    let _ = write!(html, "<dt>{}</dt><dd>", h(fact.label));
                    match &fact.url {
                        Some(url) => {
                            let _ = write!(
                                html,
                                r#"<a href="{}" rel="noopener noreferrer">{}</a>"#,
                                h(url),
                                h(&fact.value)
                            );
                        }
                        None => html.push_str(&h(&fact.value)),
                    }
                    html.push_str("</dd>");
                }
                html.push_str("</dl>");
            }
            html.push_str("</li>");
        }
        html.push_str("</ol>");
    }
    html.push_str("</section>");
}

fn folder_settings(html: &mut String, folder: &Folder, paths: &[(String, String)], csrf: &str) {
    let _ = write!(
        html,
        r#"<div id="folder-settings" popover><h2>Folder settings</h2><form action="/folders/{id}/rename" method="post">{csrf}<label for="rename">Name</label><input id="rename" name="name" required maxlength="{MAX_FOLDER_NAME}" value="{name}"><div class="dialog-actions"><button type="submit">Rename</button></div></form><form action="/folders/{id}/move" method="post">{csrf}<label for="move-folder">Move into</label>{select}<div class="dialog-actions"><button type="submit">Move folder</button></div></form><form action="/folders/{id}/delete" method="post" style="border-top:1px solid var(--line);margin-top:16px;padding-top:12px">{csrf}<p class="hint">Only an empty folder can be deleted.</p><div class="dialog-actions"><button type="button" popovertarget="folder-settings" popovertargetaction="hide">Close</button><button class="danger" type="submit">Delete folder</button></div></form></div>"#,
        id = h(&folder.id),
        name = h(folder.name.as_deref().unwrap_or("")),
        select = folder_select(
            "move-folder",
            "parent",
            paths,
            folder.parent_id.as_deref(),
            "Library (top level)"
        )
    );
}

/// Opens an asset card link. The caller adds any extra lines and closes the `<a>`.
fn card(html: &mut String, asset: &Asset, keep: &[(&str, &str)], selected: Option<&str>) {
    let mut pairs = keep.to_vec();
    pairs.push(("asset", asset.id.as_str()));
    let link = href(&pairs);
    let name = asset.name.as_deref().unwrap_or(&asset.id);
    let _ = write!(
        html,
        r#"<a class="card" href="{}"{} data-status="{}">"#,
        h(&link),
        if selected == Some(asset.id.as_str()) {
            r#" aria-current="true""#
        } else {
            ""
        },
        decision(asset).as_str()
    );
    // Only an allowed image with a stored file gets a thumbnail.
    if deliverable(asset) {
        let _ = write!(
            html,
            r#"<span class="thumb"><img src="/assets/{}/thumb" alt="" loading="lazy">{}</span>"#,
            h(&asset.id),
            if decision(asset) == Decision::Limited {
                badge(asset)
            } else {
                String::new()
            }
        );
    } else {
        let tone = match state_tone(asset) {
            "blocked" => " bad",
            "pending" => " wait",
            "restricted" | "error" => " warn",
            _ => "",
        };
        let _ = write!(
            html,
            r#"<span class="thumb state{tone}"><strong>{}</strong><small>{}</small></span>"#,
            h(state_label(asset)),
            h(&short_reason(asset))
        );
    }
    let _ = write!(
        html,
        r#"<span class="name">{}</span><span class="sub">{}</span>"#,
        h(name),
        h(&secondary_line(asset))
    );
}

/// Photographer and catalogue ID, the two things a team scans a grid for.
fn secondary_line(asset: &Asset) -> String {
    let photographer = metadata_value(asset, META_PHOTOGRAPHER);
    let parts: Vec<&str> = [photographer, catalogue_id(asset).unwrap_or("")]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() {
        "No credit".into()
    } else {
        parts.join(" · ")
    }
}

/// One line saying why an undelivered image is not shown.
fn short_reason(asset: &Asset) -> String {
    let decision = decision(asset);
    if content_removed(asset) && decision != Decision::Purged {
        return removal_reason(asset).into();
    }
    if let Some(review) = latest_review(asset) {
        return format!(
            "By {}",
            review.reviewer_name.as_deref().unwrap_or("a reviewer")
        );
    }
    let categories: Vec<&str> = flagged_categories(asset)
        .iter()
        .map(category_label)
        .collect();
    match decision {
        Decision::Pending => "Checking the image".into(),
        Decision::Failed => "Upload it again".into(),
        Decision::AgeRestricted if categories.is_empty() => "Not shown without an age check".into(),
        _ if !categories.is_empty() => categories.join(", "),
        _ => String::new(),
    }
}

fn removal_reason(asset: &Asset) -> &'static str {
    match asset.content.removal_reason {
        Some(AssetContentRemovalReason::Policy) => "Deleted by policy",
        Some(AssetContentRemovalReason::Retention) => "Not kept after processing",
        Some(AssetContentRemovalReason::Disposed) => "Disposed after a safety hold",
        _ => "Removed by your team",
    }
}

fn detail(
    html: &mut String,
    app: &PageContext,
    view: &View,
    asset: &Asset,
    paths: &[(String, String)],
    csrf: &str,
) {
    let id = h(&asset.id);
    let removed = content_removed(asset);
    let current = view.query.folder.as_deref();
    let mut close = vec![];
    if let Some(folder) = current {
        close.push(("folder", folder));
    }
    if !view.query.status.is_empty() {
        close.push(("status", view.query.status));
    }
    if !view.query.search.is_empty() {
        close.push(("q", view.query.search.as_str()));
        close.push(("mode", view.query.mode));
    }
    let _ = write!(
        html,
        r#"<aside class="detail" aria-labelledby="selected"><div class="detail-head"><h2 id="selected">{}</h2><a class="button quiet" href="{}" aria-label="Close details">✕</a></div>"#,
        h(asset.name.as_deref().unwrap_or(&asset.id)),
        h(&href(&close))
    );
    if deliverable(asset) {
        let _ = write!(
            html,
            r#"<div class="preview has-image"><img src="/assets/{id}/thumb" alt="{}"></div>"#,
            h(asset.description.as_deref().unwrap_or(""))
        );
    } else {
        let _ = write!(
            html,
            r#"<div class="preview">{}</div>"#,
            h(if removed {
                "The file is no longer stored."
            } else {
                "No preview until the image is allowed."
            })
        );
    }

    // Status and the reason from the moderation report or the reviewer.
    let _ = write!(
        html,
        r#"<div class="status" data-status="{}">{}"#,
        decision(asset).as_str(),
        badge(asset)
    );
    let categories: Vec<&str> = flagged_categories(asset)
        .iter()
        .map(category_label)
        .collect();
    if let Some(review) = latest_review(asset) {
        let _ = write!(
            html,
            "<p><strong>{}</strong> decided {}",
            h(review.reviewer_name.as_deref().unwrap_or("A reviewer")),
            h(review.decision.as_str())
        );
        if let Some(note) = review.note.as_deref().filter(|note| !note.is_empty()) {
            let _ = write!(html, ": “{}”", h(note));
        }
        html.push_str("</p>");
    } else if !categories.is_empty() {
        let _ = write!(
            html,
            r#"<p data-flagged="{}">Flagged for <strong>{}</strong></p>"#,
            h(&flagged_categories(asset)
                .iter()
                .map(|category| category.as_str())
                .collect::<Vec<_>>()
                .join(" ")),
            h(&categories.join(", "))
        );
    }
    let explanation = match decision(asset) {
        _ if removed && decision(asset) != Decision::Purged => {
            "The record, details and moderation report remain; the file is no longer served."
        }
        Decision::Pending => "Checking the image. It appears once it is allowed.",
        Decision::Allowed => "Available to download.",
        Decision::Limited => "Available to download. Marked for reduced reach.",
        Decision::AgeRestricted => "This library has no age check, so it is not delivered.",
        Decision::Blocked => "Not delivered. The file is kept for review.",
        Decision::Purged => "Not delivered. The file was deleted by policy.",
        Decision::Failed => "The image could not be processed. Upload it again.",
    };
    let _ = write!(html, "<p>{}</p>", h(explanation));
    if app.demo && matches!(decision(asset), Decision::Allowed | Decision::Limited) && !removed {
        let _ = write!(
            html,
            r#"<form action="/demo/review" method="post" style="margin-top:8px">{csrf}<input type="hidden" name="asset" value="{id}"><button class="quiet" type="submit" style="padding:0;font-weight:400;font-size:13px;text-decoration:underline;color:var(--muted)">Demo: simulate a reviewer blocking it</button></form>"#
        );
    }
    html.push_str("</div>");

    // Downloads through lenses.
    if deliverable(asset) {
        let _ = write!(
            html,
            r#"<div class="actions"><a class="button primary grow" href="/assets/{id}/download">Download web size</a><a class="button" href="/assets/{id}/thumb" target="_blank" rel="noopener">Thumbnail</a></div><p class="hint">1600px WebP and 320px square, through signed links that expire after 60 seconds.</p>"#
        );
    }

    // Details.
    let folder_path = asset
        .folder_id
        .as_deref()
        .and_then(|id| paths.iter().find(|(folder, _)| folder == id))
        .map(|(_, path)| path.as_str())
        .unwrap_or("Library (top level)");
    let _ = write!(
        html,
        r#"<section class="block" aria-labelledby="details"><div class="detail-head"><h3 id="details" class="section-title" style="flex:1">Details</h3><button class="quiet" type="button" popovertarget="edit-dialog">Edit</button></div><dl class="props"><dt>Catalogue ID</dt><dd class="mono">{}</dd><dt>Folder</dt><dd>{}</dd><dt>Photographer</dt><dd>{}</dd><dt>Licence</dt><dd>{}</dd><dt>Campaign</dt><dd>{}</dd><dt>Tags</dt><dd class="chips">"#,
        h(catalogue_id(asset).unwrap_or("—")),
        h(folder_path),
        h(or_dash(metadata_value(asset, META_PHOTOGRAPHER))),
        h(or_dash(licence_label(metadata_value(asset, META_LICENCE)))),
        h(or_dash(metadata_value(asset, META_CAMPAIGN))),
    );
    let tags = asset.tags.clone().unwrap_or_default();
    if tags.is_empty() {
        html.push('—');
    }
    for tag in &tags {
        let _ = write!(html, r#"<span class="tag">{}</span>"#, h(tag));
    }
    let _ = write!(
        html,
        "</dd><dt>Description</dt><dd>{}</dd>",
        h(or_dash(asset.description.as_deref().unwrap_or("")))
    );
    let image = asset.content.image.as_ref();
    if let (Some(width), Some(height)) = (
        image.and_then(|image| image.width),
        image.and_then(|image| image.height),
    ) {
        let _ = write!(html, "<dt>Dimensions</dt><dd>{width} × {height}</dd>");
    }
    if let Some(size) = asset.content.size_in_bytes {
        let _ = write!(html, "<dt>File size</dt><dd>{}</dd>", file_size(size));
    }
    html.push_str("</dl></section>");

    // History: upload, decision and reviews.
    html.push_str(r#"<section class="block" aria-labelledby="history"><h3 id="history" class="section-title">History</h3><ol class="history">"#);
    if let Some(at) = asset.created_at {
        let _ = write!(html, "<li>Uploaded<time>{}</time></li>", date(at));
    }
    if let Some(at) = asset.classification.completed_at {
        let _ = write!(
            html,
            "<li>Checked: {}<time>{}</time></li>",
            h(automatic_outcome(asset)),
            date(at)
        );
    }
    for review in &asset.classification.moderation.manual_reviews {
        let _ = write!(
            html,
            "<li>{} by {}<time>{}</time></li>",
            h(review.decision.as_str()),
            h(review.reviewer_name.as_deref().unwrap_or("a reviewer")),
            date(review.reviewed_at)
        );
    }
    if removed {
        if let Some(at) = asset.content.updated_at {
            let _ = write!(html, "<li>File removed<time>{}</time></li>", date(at));
        }
    }
    html.push_str("</ol></section>");

    // Lifecycle actions.
    html.push_str(r#"<section class="block"><div class="actions" style="margin-top:0"><button type="button" popovertarget="move-dialog">Move</button>"#);
    if !removed {
        html.push_str(r#"<button class="danger" type="button" popovertarget="remove-dialog">Remove file</button>"#);
    }
    html.push_str(r#"<button class="danger" type="button" popovertarget="delete-dialog">Delete</button></div></section></aside>"#);

    // Dialogs for this asset.
    let _ = write!(
        html,
        r#"<div id="edit-dialog" popover><form action="/assets/{id}/edit" method="post">{csrf}<h2>Edit details</h2><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="{MAX_DESCRIPTION}">{}</textarea><label for="edit-tags">Tags <small>(comma-separated)</small></label><input id="edit-tags" name="tags" value="{}">{}<div class="dialog-actions"><button type="button" popovertarget="edit-dialog" popovertargetaction="hide">Cancel</button><button class="primary" type="submit">Save details</button></div></form></div>"#,
        h(asset.description.as_deref().unwrap_or("")),
        h(&tags.join(", ")),
        metadata_inputs("edit", Some(asset))
    );
    let _ = write!(
        html,
        r#"<div id="move-dialog" popover><form action="/assets/{id}/move" method="post">{csrf}<h2>Move image</h2><label for="move-asset">Folder</label>{}<div class="dialog-actions"><button type="button" popovertarget="move-dialog" popovertargetaction="hide">Cancel</button><button class="primary" type="submit">Move image</button></div></form></div>"#,
        folder_select(
            "move-asset",
            "folder",
            paths,
            asset.folder_id.as_deref(),
            "Library (top level)"
        )
    );
    if !removed {
        let _ = write!(
            html,
            r#"<div id="remove-dialog" popover><form action="/assets/{id}/remove-file" method="post">{csrf}<input type="hidden" name="confirm" value="yes"><h2>Remove the file?</h2><p class="hint">The stored image is deleted and no longer served. The record, its details and moderation report stay in the library.</p><div class="dialog-actions"><button type="button" popovertarget="remove-dialog" popovertargetaction="hide">Cancel</button><button class="danger solid" type="submit">Remove file</button></div></form></div>"#
        );
    }
    let _ = write!(
        html,
        r#"<div id="delete-dialog" popover><form action="/assets/{id}/delete" method="post">{csrf}<input type="hidden" name="return_folder" value="{}"><h2>Delete this image?</h2><p class="hint">The record, its details and the file are deleted. This cannot be undone.</p><label><input type="checkbox" name="confirm" value="yes" required style="width:auto;margin-right:6px">Delete {}</label><div class="dialog-actions"><button type="button" popovertarget="delete-dialog" popovertargetaction="hide">Cancel</button><button class="danger solid" type="submit">Delete</button></div></form></div>"#,
        h(current.unwrap_or("")),
        h(asset.name.as_deref().unwrap_or("this image"))
    );
}

/// What automatic moderation decided, before any reviewer changed it.
fn automatic_outcome(asset: &Asset) -> &str {
    asset
        .classification
        .moderation
        .policy
        .as_ref()
        .and_then(|policy| policy.decision.as_ref())
        .and_then(|decision| decision.action.as_deref())
        .map(|action| match action {
            "allow" => "allowed",
            "limit" => "limited",
            "age-restrict" => "age-restricted",
            "block" => "blocked",
            "purge" => "purged",
            other => other,
        })
        .or_else(|| {
            if latest_review(asset).is_none() {
                Some(decision(asset).as_str())
            } else {
                None
            }
        })
        .unwrap_or("decided")
}

fn or_dash(value: &str) -> &str {
    if value.is_empty() {
        "—"
    } else {
        value
    }
}

fn file_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}

/// "26 Oct 2026, 14:05 UTC" from milliseconds since the Unix epoch.
fn date(ms: u64) -> String {
    let seconds = ms / 1000;
    let days = (seconds / 86_400) as i64;
    let (hour, minute) = (seconds % 86_400 / 3600, seconds % 3600 / 60);
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{day} {} {year}, {hour:02}:{minute:02} UTC",
        MONTHS[(month - 1) as usize]
    )
}

fn state_label(asset: &Asset) -> &'static str {
    let decision = decision(asset);
    if content_removed(asset) && decision != Decision::Purged {
        return "File removed";
    }
    match decision {
        Decision::Allowed => "Allowed",
        Decision::Limited => "Limited",
        Decision::AgeRestricted => "Age-restricted",
        Decision::Blocked => "Blocked",
        Decision::Purged => "Purged",
        Decision::Failed => "Processing failed",
        Decision::Pending => "Processing",
    }
}

fn state_tone(asset: &Asset) -> &'static str {
    let decision = decision(asset);
    if content_removed(asset) && decision != Decision::Purged {
        return "removed";
    }
    match decision {
        Decision::Allowed | Decision::Limited => "allowed",
        Decision::AgeRestricted => "restricted",
        Decision::Blocked | Decision::Purged => "blocked",
        Decision::Failed => "error",
        Decision::Pending => "pending",
    }
}

fn badge(asset: &Asset) -> String {
    format!(
        r#"<span class="tag {}">{}</span>"#,
        state_tone(asset),
        state_label(asset)
    )
}

fn licence_label(value: &str) -> &str {
    LICENCES
        .iter()
        .find(|(key, _)| *key == value)
        .map(|(_, label)| *label)
        .unwrap_or(value)
}

fn metadata_inputs(prefix: &str, asset: Option<&Asset>) -> String {
    let value = |id: &str| asset.map(|asset| metadata_value(asset, id)).unwrap_or("");
    let licence = value(META_LICENCE);
    let mut licences = String::from(r#"<option value="">Not set</option>"#);
    for (key, label) in LICENCES {
        let _ = write!(
            licences,
            r#"<option value="{}"{}>{}</option>"#,
            h(key),
            if key == licence { " selected" } else { "" },
            h(label)
        );
    }
    format!(
        r#"<div class="row"><div><label for="{prefix}-photographer">Photographer</label><input id="{prefix}-photographer" name="photographer" maxlength="{MAX_META}" value="{}"></div><div><label for="{prefix}-licence">Licence</label><select id="{prefix}-licence" name="licence">{licences}</select></div></div><label for="{prefix}-campaign">Campaign</label><input id="{prefix}-campaign" name="campaign" maxlength="{MAX_META}" value="{}">"#,
        h(value(META_PHOTOGRAPHER)),
        h(value(META_CAMPAIGN))
    )
}

fn options(choices: &[(&str, &str)], selected: &str) -> String {
    choices
        .iter()
        .map(|(value, label)| {
            format!(
                r#"<option value="{}"{}>{}</option>"#,
                h(value),
                if *value == selected { " selected" } else { "" },
                h(label)
            )
        })
        .collect()
}

fn folder_select(
    id: &str,
    name: &str,
    paths: &[(String, String)],
    selected: Option<&str>,
    root: &str,
) -> String {
    let mut out = format!(
        r#"<select id="{id}" name="{name}"><option value="">{}</option>"#,
        h(root)
    );
    for (folder, path) in paths {
        let _ = write!(
            out,
            r#"<option value="{}"{}>{}</option>"#,
            h(folder),
            if selected == Some(folder.as_str()) {
                " selected"
            } else {
                ""
            },
            h(path)
        );
    }
    out.push_str("</select>");
    out
}

/// The folder's ancestors, nearest first, bounded in case the data ever contains a cycle.
fn ancestors<'a>(folders: &'a [Folder], folder: &Folder) -> Vec<&'a Folder> {
    let mut out = Vec::new();
    let mut parent = folder.parent_id.as_deref();
    for _ in 0..32 {
        let Some(id) = parent else { break };
        let Some(next) = folders.iter().find(|folder| folder.id == id) else {
            break;
        };
        out.push(next);
        parent = next.parent_id.as_deref();
    }
    out
}

/// `(id, "Parent / Child")` for every folder, sorted by path.
fn folder_paths(folders: &[Folder]) -> Vec<(String, String)> {
    let mut paths: Vec<(String, String)> = folders
        .iter()
        .map(|folder| {
            let mut names = vec![folder.name.clone().unwrap_or_default()];
            names.extend(
                ancestors(folders, folder)
                    .iter()
                    .map(|folder| folder.name.clone().unwrap_or_default()),
            );
            names.reverse();
            (folder.id.clone(), names.join(" / "))
        })
        .collect();
    paths.sort_by_key(|(_, path)| path.to_lowercase());
    paths
}

fn tree(
    html: &mut String,
    folders: &[Folder],
    parent: Option<&str>,
    current: Option<&str>,
    seen: &mut HashSet<String>,
) {
    let mut children: Vec<&Folder> = folders
        .iter()
        .filter(|folder| folder.parent_id.as_deref() == parent)
        .collect();
    children.sort_by_key(|folder| folder.name.clone().unwrap_or_default().to_lowercase());
    for folder in children {
        if !seen.insert(folder.id.clone()) {
            continue;
        }
        let _ = write!(
            html,
            r#"<li><a href="{}"{}>{FOLDER_ICON}{}</a>"#,
            h(&href(&[("folder", folder.id.as_str())])),
            if current == Some(folder.id.as_str()) {
                r#" aria-current="page""#
            } else {
                ""
            },
            h(folder.name.as_deref().unwrap_or("Untitled"))
        );
        if folders
            .iter()
            .any(|child| child.parent_id.as_deref() == Some(folder.id.as_str()))
        {
            html.push_str("<ul>");
            tree(html, folders, Some(&folder.id), current, seen);
            html.push_str("</ul>");
        }
        html.push_str("</li>");
    }
}

pub fn h(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 16);
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}
