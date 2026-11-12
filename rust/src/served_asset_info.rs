use reqwest::header::HeaderMap;

/// Pixel dimensions of the representation served by the CDN.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct ServedAssetInfo {
    /// Width in pixels.
    pub width: u64,
    /// Height in pixels.
    pub height: u64,
}

impl ServedAssetInfo {
    pub(crate) fn from_headers(headers: &HeaderMap) -> Option<Self> {
        let mut width = None;
        let mut height = None;
        for value in headers.get_all("x-calmlens-asset-info") {
            let mut quoted = false;
            let mut escaped = false;
            for member in value.to_str().ok()?.split(|ch| {
                if escaped {
                    escaped = false;
                } else if quoted && ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    quoted = !quoted;
                } else if ch == ',' && !quoted {
                    return true;
                }
                false
            }) {
                let member = member.trim();
                let key = member.split(['=', ';', ' ', '\t']).next()?;
                let dimension = match key {
                    "width" => &mut width,
                    "height" => &mut height,
                    _ => continue,
                };
                let value = member.strip_prefix(key)?.strip_prefix('=')?;
                if dimension.is_some()
                    || value.len() > 15
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return None;
                }
                *dimension = Some(value.parse::<u64>().ok().filter(|size| *size > 0)?);
            }
            if quoted {
                return None;
            }
        }
        Some(Self {
            width: width?,
            height: height?,
        })
    }
}
