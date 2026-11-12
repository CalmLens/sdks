//! The value of an enum variant this SDK version does not know.
use std::fmt;

/// A wire value an enum of this SDK version does not list, such as an event type the API added
/// later. It can be read with [`as_str`](Self::as_str) but not constructed, so code that needs a
/// value this version doesn't list compares the enum's `as_str()` in a `_` arm instead of matching
/// `Unknown`; that comparison keeps working once a later version adds the variant.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct UnknownValue(String);

impl UnknownValue {
    pub(crate) fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
    /// The wire value.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for UnknownValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, f)
    }
}
impl fmt::Display for UnknownValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
