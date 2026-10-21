//! Server-rendered HTML with no JavaScript or external assets. Every dynamic value goes through
//! [`h`].
use crate::app::{
    catalogue_id, content_removed, decision, deliverable, href, metadata_value, Decision,
    PageContext, View, LICENCES, MAX_CATALOGUE_ID, MAX_DESCRIPTION, MAX_FOLDER_NAME, MAX_META,
    MAX_NAME, MAX_QUERY, META_CAMPAIGN, META_LICENCE, META_PHOTOGRAPHER, SEARCH_MODES,
    STATUS_FILTERS,
};
use crate::demo::DEMO_OUTCOMES;
use calmlens::models::{Asset, Folder, SearchMatchField};
use std::collections::HashSet;
use std::fmt::Write;
use std::time::UNIX_EPOCH;

const STYLE: &str = "
:root{font-family:system-ui,sans-serif;color:#28263a;background:#f3f2f8;line-height:1.55}*{box-sizing:border-box}body{margin:0}
main{max-width:1240px;margin:auto;padding:36px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #dcd9e8;padding-bottom:20px}
.wordmark{font-size:22px;font-weight:750;letter-spacing:-.5px}.mode,.badge{display:inline-block;padding:3px 10px;border-radius:30px;background:#e5e2f1;font-size:12px;font-weight:650}
h1{font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-1.5px;margin:30px 0 10px}.intro{max-width:700px;color:#615e74}
.notice{background:#fff;border:1px solid #dcd9e8;border-left:4px solid #7a5cc7;border-radius:10px;padding:12px 16px;margin-top:22px}.notice code{font-size:13px;background:#efedf6;padding:1px 6px;border-radius:6px}
.layout{display:grid;grid-template-columns:300px 1fr;gap:26px;margin-top:28px}.panel,.card{background:#fff;border:1px solid #dcd9e8;border-radius:16px;padding:18px}
.side>*+*{margin-top:18px}h2{font-size:18px;margin:0 0 12px}h3{font-size:15px;margin:14px 0 6px}label{display:block;font-size:14px;font-weight:650;margin:10px 0 5px}
input,select,textarea,button{font:inherit;width:100%;padding:9px;border-radius:9px}input,select,textarea{border:1px solid #c9c4dc;background:#fdfcff}textarea{min-height:80px;resize:vertical}
input[type=checkbox]{width:auto;margin-right:6px}button{border:0;background:#5b45b0;color:#fff;font-weight:650;cursor:pointer;margin-top:12px}button:hover{background:#4a378f}
button.secondary{background:#e5e2f1;color:#28263a}button.danger{background:#a23b31}button.danger:hover{background:#86302a}
:focus-visible{outline:3px solid #c08a1e;outline-offset:2px}.hint,small{font-size:12px;color:#615e74}a{color:#4a378f}
.tree,.tree ul{list-style:none;margin:0;padding:0}.tree ul{padding-left:14px;border-left:1px solid #ebe8f3;margin-left:6px}.tree a{display:block;padding:3px 6px;border-radius:7px;text-decoration:none;color:#28263a;overflow-wrap:anywhere}
.tree a[aria-current]{background:#e5e2f1;font-weight:650}.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.bar>*{flex:1;min-width:140px}.bar button{flex:0 0 auto;width:auto;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin-top:14px}.card{padding:10px;text-decoration:none;color:inherit;display:block}.card[aria-current]{border-color:#7a5cc7;box-shadow:0 0 0 2px #cfc5ee}
.thumb{aspect-ratio:1;border-radius:10px;background:#e9e6f4;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:#615e74;overflow:hidden;padding:8px}.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.card strong{display:block;font-size:14px;margin-top:8px;overflow-wrap:anywhere}.approved{background:#dcefe5;color:#24573f}.pending{background:#e2e8f3;color:#344e78}.rejected,.error,.removed{background:#fbe1df;color:#8a3a31}.simulated{background:#fff0cc;color:#6b5013}
.empty{text-align:center;color:#615e74;padding:40px 16px;grid-column:1/-1}section{margin-top:22px}.pager{display:flex;gap:12px;justify-content:space-between;margin-top:14px;font-size:14px}
.detail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}dl{display:grid;grid-template-columns:max-content 1fr;gap:3px 12px;margin:6px 0 0;font-size:13px}dt{color:#615e74}dd{margin:0;overflow-wrap:anywhere}
ol{list-style:none;padding:0;margin:0}ol li{border-top:1px solid #ebe8f3;padding:8px 0;font-size:14px}ol dl{font-size:12px;color:#615e74}
@media(max-width:900px){.layout,.detail{grid-template-columns:1fr}}@media(max-width:560px){header{flex-direction:column;align-items:flex-start}}
";

pub(crate) fn render(app: &PageContext, view: &View) -> String {
    let mut html = String::with_capacity(16 * 1024);
    let csrf = format!(
        r#"<input type="hidden" name="csrf" value="{}">"#,
        h(&app.csrf)
    );
    let _ = write!(
        html,
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calmlibrary · Rust SDK example</title><style>{STYLE}</style></head><body><main><header><div class="wordmark">◫ Calmlibrary</div><span class="mode">{}</span></header><h1>Your team’s images.<br>Private until approved.</h1><p class="intro">A private media library: folders, credits and licences, natural-language search, thumbnails and web-size downloads through lenses, and file removal. A small, working example of the CalmLens Rust SDK.</p>"#,
        if app.demo {
            "Demo · simulated library"
        } else {
            "Live · CalmLens storage and moderation"
        }
    );
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
        html.push_str("</main></body></html>");
        return html;
    }
    let paths = folder_paths(&view.folders);
    let current = view.query.folder.as_deref();

    // ------------------------------------------------------------ sidebar
    html.push_str(r#"<div class="layout"><div class="side"><nav class="panel" aria-labelledby="folders"><h2 id="folders">Folders</h2><ul class="tree">"#);
    let _ = write!(
        html,
        r#"<li><a href="/"{}>All assets</a></li>"#,
        if current.is_none() && view.query.search.is_empty() {
            r#" aria-current="page""#
        } else {
            ""
        }
    );
    tree(&mut html, &view.folders, None, current, &mut HashSet::new());
    html.push_str("</ul>");
    let _ = write!(
        html,
        r#"<form action="/folders" method="post"><h3>New folder</h3>{csrf}<label for="folder-name">Name</label><input id="folder-name" name="name" required maxlength="{MAX_FOLDER_NAME}"><label for="folder-parent">Inside</label>{}<button type="submit">Create folder</button></form></nav>"#,
        folder_select("folder-parent", "parent", &paths, current, "Project root")
    );

    let _ = write!(
        html,
        r#"<form class="panel" action="/assets" method="post" enctype="multipart/form-data"><h2>Upload an image</h2>{csrf}<label for="file">Image</label><input id="file" name="file" type="file" required accept="image/jpeg,image/png,image/gif,image/webp"><label for="upload-folder">Folder</label>{}<label for="upload-name">Name <small>(optional)</small></label><input id="upload-name" name="name" maxlength="{MAX_NAME}"><label for="upload-description">Description</label><textarea id="upload-description" name="description" maxlength="{MAX_DESCRIPTION}"></textarea>{}<label for="external-id">Catalogue ID <small>(optional)</small></label><input id="external-id" name="external_id" maxlength="{MAX_CATALOGUE_ID}" pattern="[A-Za-z0-9._:\-]+"><p class="hint">Stored as the asset’s external ID with the prefix calmlibrary:, and unique in the project.</p>"#,
        folder_select("upload-folder", "folder", &paths, current, "Project root"),
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
        html.push_str(r#"</select><p class="hint">Demo mode keeps the library in memory and applies the outcome you choose. Nothing is classified.</p>"#);
    }
    html.push_str(r#"<p class="hint">JPEG, PNG, GIF or WebP up to 5MiB, uploaded privately.</p><button type="submit">Upload</button></form></div><div>"#);

    // ------------------------------------------------------------ search
    let _ = write!(
        html,
        r#"<form class="panel" action="/" method="get" role="search"><div class="bar"><div><label for="q">Search the library</label><input id="q" name="q" type="search" maxlength="{MAX_QUERY}" value="{}" placeholder="e.g. cyclists at sunrise"></div><div style="flex:0 0 140px"><label for="mode">Mode</label><select id="mode" name="mode">{}</select></div><button type="submit">Search</button></div></form>"#,
        h(&view.query.search),
        options(&SEARCH_MODES, view.query.mode)
    );

    if let Some(results) = &view.search {
        let _ = write!(
            html,
            r#"<section aria-labelledby="results"><h2 id="results">Results for “{}”</h2><p class="hint">Semantic status: <span class="badge" data-semantic-status="{status}">{status}</span>"#,
            h(&results.query),
            status = h(results.semantic_status.as_str())
        );
        if app.demo {
            html.push_str(r#" <span class="badge simulated">Simulated: local keyword matching over names, descriptions, tags and metadata. No semantic matching offline.</span>"#);
        }
        html.push_str(r#"</p><p class="hint">Rejected, unfinished and removed images are never returned. <a href="/">Back to the library</a></p><div class="grid">"#);
        if results.items.is_empty() {
            html.push_str(r#"<p class="empty">No matching images.</p>"#);
        }
        for item in &results.items {
            card(&mut html, &item.asset, None, view.query.asset.as_deref());
            let _ = write!(
                html,
                r#"<small>Matched: <span data-matched-fields="{fields}">{fields}</span> · score {:.2}</small></a>"#,
                item.score,
                fields = h(&item
                    .matched_fields
                    .iter()
                    .map(SearchMatchField::as_str)
                    .collect::<Vec<_>>()
                    .join(", "))
            );
        }
        html.push_str("</div></section>");
    }

    // ------------------------------------------------------------ folder listing
    if let Some(listing) = &view.listing {
        let title = current
            .and_then(|id| paths.iter().find(|(folder, _)| folder == id))
            .map(|(_, path)| path.as_str())
            .unwrap_or("All assets");
        let _ = write!(
            html,
            r#"<section aria-labelledby="listing"><div class="bar"><h2 id="listing" style="margin:0">{}</h2><form action="/" method="get" class="bar">"#,
            h(title)
        );
        if let Some(id) = current {
            let _ = write!(
                html,
                r#"<input type="hidden" name="folder" value="{}">"#,
                h(id)
            );
        }
        let _ = write!(
            html,
            r#"<div><label for="status">Status</label><select id="status" name="status">{}</select></div><button class="secondary" type="submit">Filter</button></form></div><div class="grid">"#,
            options(&STATUS_FILTERS, view.query.status)
        );
        if listing.items.is_empty() {
            html.push_str(r#"<p class="empty">No images here yet.</p>"#);
        }
        for asset in &listing.items {
            card(&mut html, asset, current, view.query.asset.as_deref());
            html.push_str("</a>");
        }
        html.push_str("</div>");
        let link = |cursor: Option<&str>| {
            let mut pairs = vec![];
            if let Some(cursor) = cursor {
                pairs.push(("cursor", cursor));
            }
            if let Some(id) = current {
                pairs.push(("folder", id));
            }
            if !view.query.status.is_empty() {
                pairs.push(("status", view.query.status));
            }
            href(&pairs)
        };
        html.push_str(r#"<nav class="pager" aria-label="Pages"><span>"#);
        if view.query.cursor.is_some() {
            let _ = write!(html, r#"<a href="{}">First page</a>"#, h(&link(None)));
        }
        html.push_str("</span><span>");
        if let Some(cursor) = listing.next_cursor.as_deref() {
            let _ = write!(html, r#"<a href="{}">Next →</a>"#, h(&link(Some(cursor))));
        }
        html.push_str("</span></nav>");

        if let Some(id) = current {
            let _ = write!(
                html,
                r#"<details class="panel" style="margin-top:14px"><summary>Folder settings</summary><div class="bar"><form action="/folders/{id}/rename" method="post">{csrf}<label for="rename">Rename</label><input id="rename" name="name" required maxlength="{MAX_FOLDER_NAME}" value="{name}"><button class="secondary" type="submit">Rename</button></form><form action="/folders/{id}/move" method="post">{csrf}<label for="move-folder">Move into</label>{select}<button class="secondary" type="submit">Move folder</button></form><form action="/folders/{id}/delete" method="post">{csrf}<p class="hint">Only an empty folder can be deleted.</p><button class="danger" type="submit">Delete folder</button></form></div></details>"#,
                id = h(id),
                name = h(view
                    .folders
                    .iter()
                    .find(|folder| folder.id == id)
                    .and_then(|folder| folder.name.as_deref())
                    .unwrap_or("")),
                select = folder_select("move-folder", "parent", &paths, None, "Project root")
            );
        }
        html.push_str("</section>");
    }

    // ------------------------------------------------------------ selected asset
    if let Some(asset) = &view.selected {
        detail(&mut html, app, asset, &paths, &csrf, current);
    }

    // ------------------------------------------------------------ activity
    html.push_str(
        r#"<section class="panel" aria-labelledby="activity"><h2 id="activity">Activity</h2>"#,
    );
    let _ = write!(
        html,
        r#"<p class="hint">{}</p>"#,
        if app.webhooks_enabled {
            "Verified webhooks at /webhooks/calmlens refresh decisions here."
        } else {
            "Set CALMLENS_WEBHOOK_SECRET to receive webhooks."
        }
    );
    if app.activity.is_empty() {
        html.push_str(r#"<p class="hint">No activity yet.</p>"#);
    } else {
        html.push_str("<ol>");
        for entry in &app.activity {
            let seconds = entry
                .at
                .duration_since(UNIX_EPOCH)
                .map(|time| time.as_secs())
                .unwrap_or(0)
                % 86_400;
            let _ = write!(
                html,
                "<li><small>{:02}:{:02}:{:02} UTC</small> {}",
                seconds / 3600,
                seconds / 60 % 60,
                seconds % 60,
                h(&entry.text)
            );
            if !entry.facts.is_empty() {
                html.push_str("<dl>");
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
    html.push_str(r#"</section></div></div><footer class="hint" style="margin-top:28px">A small learning example with no sign-in. Demo state resets on restart.</footer></main></body></html>"#);
    html
}

/// Opens an asset card link. The caller adds any extra lines and closes the `<a>`.
fn card(html: &mut String, asset: &Asset, folder: Option<&str>, selected: Option<&str>) {
    let mut pairs = vec![("asset", asset.id.as_str())];
    if let Some(folder) = folder {
        pairs.push(("folder", folder));
    }
    let link = href(&pairs);
    let name = asset.name.as_deref().unwrap_or(&asset.id);
    let _ = write!(
        html,
        r#"<a class="card" href="{}"{}><div class="thumb">"#,
        h(&link),
        if selected == Some(asset.id.as_str()) {
            r#" aria-current="true""#
        } else {
            ""
        }
    );
    // Only an approved image with a stored file gets a thumbnail.
    if deliverable(asset) {
        let _ = write!(
            html,
            r#"<img src="/assets/{}/thumb" alt="" loading="lazy">"#,
            h(&asset.id)
        );
    } else {
        html.push_str(&h(state_label(asset)));
    }
    let _ = write!(
        html,
        r#"</div><strong>{}</strong>{}"#,
        h(name),
        badge(asset)
    );
}

fn detail(
    html: &mut String,
    app: &PageContext,
    asset: &Asset,
    paths: &[(String, String)],
    csrf: &str,
    current: Option<&str>,
) {
    let id = h(&asset.id);
    let removed = content_removed(asset);
    let _ = write!(
        html,
        r#"<section class="panel" aria-labelledby="selected"><h2 id="selected">{} {}</h2><div class="detail"><div>"#,
        h(asset.name.as_deref().unwrap_or(&asset.id)),
        badge(asset)
    );
    if deliverable(asset) {
        let _ = write!(
            html,
            r#"<div class="thumb" style="max-width:320px"><img src="/assets/{id}/thumb" alt="{}"></div><p><a href="/assets/{id}/download">Download web size (1600px)</a> <small>· a 60-second signed link</small></p>"#,
            h(asset.description.as_deref().unwrap_or(""))
        );
    } else {
        let _ = write!(
            html,
            r#"<p class="hint">{}</p>"#,
            h(if removed {
                "The file was removed. The record, metadata and classification results remain; the CDN no longer serves it."
            } else {
                "No thumbnail or download until the image is approved."
            })
        );
    }
    let folder_path = asset
        .folder_id
        .as_deref()
        .and_then(|id| paths.iter().find(|(folder, _)| folder == id))
        .map(|(_, path)| path.as_str())
        .unwrap_or("Project root");
    let _ = write!(
        html,
        "<dl><dt>Status</dt><dd>{}</dd><dt>Folder</dt><dd>{}</dd><dt>Catalogue ID</dt><dd>{}</dd><dt>Photographer</dt><dd>{}</dd><dt>Licence</dt><dd>{}</dd><dt>Campaign</dt><dd>{}</dd><dt>Tags</dt><dd>{}</dd><dt>Description</dt><dd>{}</dd></dl>",
        h(decision(asset).as_str()),
        h(folder_path),
        h(catalogue_id(asset).unwrap_or("Not uploaded through Calmlibrary")),
        h(metadata_value(asset, META_PHOTOGRAPHER)),
        h(licence_label(metadata_value(asset, META_LICENCE))),
        h(metadata_value(asset, META_CAMPAIGN)),
        h(&asset.tags.clone().unwrap_or_default().join(", ")),
        h(asset.description.as_deref().unwrap_or("")),
    );
    if app.demo && decision(asset) == Decision::Approved {
        let _ = write!(
            html,
            r#"<form action="/demo/review" method="post">{csrf}<input type="hidden" name="asset" value="{id}"><button class="secondary" type="submit">Simulate a reviewer rejecting it</button></form>"#
        );
    }
    let _ = write!(
        html,
        r#"</div><div><form action="/assets/{id}/edit" method="post">{csrf}<h3>Edit details</h3><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="{MAX_DESCRIPTION}">{}</textarea><label for="edit-tags">Tags <small>(comma-separated)</small></label><input id="edit-tags" name="tags" value="{}">{}<button type="submit">Save details</button></form>"#,
        h(asset.description.as_deref().unwrap_or("")),
        h(&asset.tags.clone().unwrap_or_default().join(", ")),
        metadata_inputs("edit", Some(asset))
    );
    let _ = write!(
        html,
        r#"<form action="/assets/{id}/move" method="post">{csrf}<h3>Move</h3><label for="move-asset">Folder</label>{}<button class="secondary" type="submit">Move image</button></form>"#,
        folder_select(
            "move-asset",
            "folder",
            paths,
            asset.folder_id.as_deref(),
            "Project root"
        )
    );
    if !removed {
        let _ = write!(
            html,
            r#"<form action="/assets/{id}/remove-file" method="post">{csrf}<h3>Remove file</h3><p class="hint">Deletes the stored file only. The record, metadata and classification results stay.</p><label><input type="checkbox" name="confirm" value="yes" required>Remove this file</label><button class="danger" type="submit">Remove file</button></form>"#
        );
    }
    let _ = write!(
        html,
        r#"<form action="/assets/{id}/delete" method="post">{csrf}<input type="hidden" name="return_folder" value="{}"><h3>Delete</h3><p class="hint">Deletes the asset record and its file.</p><label><input type="checkbox" name="confirm" value="yes" required>Delete this asset</label><button class="danger" type="submit">Delete</button></form></div></div></section>"#,
        h(current.unwrap_or(""))
    );
}

fn state_label(asset: &Asset) -> &'static str {
    if content_removed(asset) {
        return "File removed";
    }
    match decision(asset) {
        Decision::Approved => "Approved",
        Decision::Rejected => "Rejected: not shown",
        Decision::Failed => "Processing failed",
        Decision::Pending => "In review",
    }
}

fn badge(asset: &Asset) -> String {
    let (class, label) = if content_removed(asset) {
        ("removed", "File removed")
    } else {
        match decision(asset) {
            Decision::Approved => ("approved", "Approved"),
            Decision::Rejected => ("rejected", "Rejected"),
            Decision::Failed => ("error", "Error"),
            Decision::Pending => ("pending", "In review"),
        }
    };
    format!(r#"<span class="badge {class}">{label}</span>"#)
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
        r#"<label for="{prefix}-photographer">Photographer</label><input id="{prefix}-photographer" name="photographer" maxlength="{MAX_META}" value="{}"><label for="{prefix}-licence">Licence</label><select id="{prefix}-licence" name="licence">{licences}</select><label for="{prefix}-campaign">Campaign</label><input id="{prefix}-campaign" name="campaign" maxlength="{MAX_META}" value="{}">"#,
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

/// `(id, "Parent / Child")` for every folder, sorted by path.
fn folder_paths(folders: &[Folder]) -> Vec<(String, String)> {
    let mut paths: Vec<(String, String)> = folders
        .iter()
        .map(|folder| {
            let mut names = vec![folder.name.clone().unwrap_or_default()];
            let mut parent = folder.parent_id.clone();
            // Bounded, in case the data ever contains a cycle.
            for _ in 0..32 {
                let Some(id) = parent else { break };
                let Some(next) = folders.iter().find(|folder| folder.id == id) else {
                    break;
                };
                names.push(next.name.clone().unwrap_or_default());
                parent = next.parent_id.clone();
            }
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
            r#"<li><a href="{}"{}>{}</a>"#,
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
