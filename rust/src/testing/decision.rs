//! Moderation decisions for [`MockOptions::moderate`](super::MockOptions::moderate) and
//! [`MockServerClient::complete_processing`](super::MockServerClient::complete_processing).
use super::classification::{CATEGORIES, QUALIFIERS};
use crate::error::ErrorCode;
use crate::models::Asset;
use crate::{Error, Result};
use serde_json::{json, Map, Value};
use std::{fmt, str::FromStr};

/// Where the mock's moderation leaves an upload: still processing, failed (retryable), or
/// decided with that moderation status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MockOutcome {
    /// Processing continues with moderation `pending`.
    Pending,
    /// Processing fails (retryable) with moderation `pending` and failure reason
    /// `processing-error`.
    Failed,
    /// Processing completes with moderation `allowed`.
    Allowed,
    /// Processing completes with moderation `limited`; the CDN serves the asset like an
    /// allowed one.
    Limited,
    /// Processing completes with moderation `age-restricted`; the CDN then serves the asset
    /// only with `ViewerClaims::age_confirmed` set to `true`, and a private one only with the
    /// download permission too.
    AgeRestricted,
    /// Processing completes with moderation `blocked`; the CDN refuses it.
    Blocked,
    /// Processing completes with moderation `purged` and the content is removed (reason `policy`).
    Purged,
}
const OUTCOMES: [MockOutcome; 7] = [
    MockOutcome::Pending,
    MockOutcome::Failed,
    MockOutcome::Allowed,
    MockOutcome::Limited,
    MockOutcome::AgeRestricted,
    MockOutcome::Blocked,
    MockOutcome::Purged,
];
impl MockOutcome {
    /// The status as the API writes it: `pending`, `failed`, `allowed`, `limited`,
    /// `age-restricted`, `blocked` or `purged`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Failed => "failed",
            Self::Allowed => "allowed",
            Self::Limited => "limited",
            Self::AgeRestricted => "age-restricted",
            Self::Blocked => "blocked",
            Self::Purged => "purged",
        }
    }
    /// Whether the outcome is a moderation decision (not `pending` or `failed`).
    pub fn is_decided(self) -> bool {
        !matches!(self, Self::Pending | Self::Failed)
    }
    /// The policy action that gives this status.
    fn action(self) -> &'static str {
        match self {
            Self::Limited => "limit",
            Self::AgeRestricted => "age-restrict",
            Self::Blocked => "block",
            Self::Purged => "purge",
            _ => "allow",
        }
    }
}
impl fmt::Display for MockOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
impl FromStr for MockOutcome {
    type Err = Error;
    /// Parses a status; anything else is `sdk/invalid-argument`.
    fn from_str(value: &str) -> Result<Self> {
        OUTCOMES
            .into_iter()
            .find(|outcome| outcome.as_str() == value)
            .ok_or_else(|| {
                let known: Vec<&str> = OUTCOMES.iter().map(|outcome| outcome.as_str()).collect();
                invalid_argument(format!("status must be one of {}", known.join(", ")))
            })
    }
}

fn invalid_argument(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidArgument, message)
}

/// The likelihood the API reports for a score.
fn likelihood(score: f64) -> &'static str {
    if score >= 0.8 {
        "very-likely"
    } else if score >= 0.6 {
        "likely"
    } else if score >= 0.4 {
        "possible"
    } else if score >= 0.2 {
        "unlikely"
    } else {
        "very-unlikely"
    }
}

fn is_score(score: f64) -> bool {
    score.is_finite() && (0.0..=1.0).contains(&score)
}

#[derive(Clone, Debug, PartialEq)]
struct Flag {
    category: &'static str,
    score: f64,
    qualifiers: Vec<(&'static str, f64)>,
}

/// A moderation decision: a status, the categories it flagged with their scores and qualifiers,
/// and the categories it could not assess. Each call checks its names and scores and fails with
/// `sdk/invalid-argument` for one CalmLens doesn't have.
///
/// A decided status fills the asset's report as the API would: every category (those not
/// flagged evaluated with score 0), the highest score, and the policy's actions and
/// `flagged_categories`. The policy acts on a category at 0.5 and above, so a flagged category
/// at 0.5 or more is listed there unless the status is `allowed`.
///
/// ```
/// # fn run() -> calmlens::Result<()> {
/// use calmlens::testing::{MockDecision, MockOutcome};
/// let decision = MockDecision::new(MockOutcome::Blocked)
///     .flag("violence", 0.92, &[("violence-threat", 0.9)])?
///     .not_evaluated("sexual")?;
/// assert_eq!(decision.status(), MockOutcome::Blocked);
/// # Ok(()) }
/// ```
#[derive(Clone, Debug, PartialEq)]
pub struct MockDecision {
    status: MockOutcome,
    flags: Vec<Flag>,
    not_evaluated: Vec<&'static str>,
}
impl From<MockOutcome> for MockDecision {
    fn from(status: MockOutcome) -> Self {
        Self::new(status)
    }
}
impl MockDecision {
    /// A decision with `status` and no findings.
    pub fn new(status: MockOutcome) -> Self {
        Self {
            status,
            flags: Vec::new(),
            not_evaluated: Vec::new(),
        }
    }
    /// The decision's status.
    pub fn status(&self) -> MockOutcome {
        self.status
    }
    /// Records findings in `category` with its `score` (0 to 1) and, optionally, scores for its
    /// qualifiers, such as `&[("violence-threat", 0.9)]`.
    ///
    /// Fails with `sdk/invalid-argument` for an unknown category or qualifier, a score outside 0
    /// to 1, a category already in the decision, or a `pending` or `failed` decision.
    pub fn flag(mut self, category: &str, score: f64, qualifiers: &[(&str, f64)]) -> Result<Self> {
        let category = self.check_new(category)?;
        if !is_score(score) {
            return Err(invalid_argument(format!(
                "{category}'s score must be from 0 to 1"
            )));
        }
        let known = QUALIFIERS
            .iter()
            .find(|(name, _)| *name == category)
            .map_or(&[][..], |(_, qualifiers)| qualifiers);
        let mut checked: Vec<(&'static str, f64)> = Vec::with_capacity(qualifiers.len());
        for &(qualifier, qualifier_score) in qualifiers {
            let Some(&qualifier) = known.iter().find(|known| **known == qualifier) else {
                return Err(invalid_argument(format!(
                    "{qualifier} is not a qualifier of {category}"
                )));
            };
            if !is_score(qualifier_score) {
                return Err(invalid_argument(format!(
                    "{qualifier}'s score must be from 0 to 1"
                )));
            }
            if checked.iter().any(|(seen, _)| *seen == qualifier) {
                return Err(invalid_argument(format!("{qualifier} is listed twice")));
            }
            checked.push((qualifier, qualifier_score));
        }
        self.flags.push(Flag {
            category,
            score,
            qualifiers: checked,
        });
        Ok(self)
    }
    /// Marks `category` as not assessed (`not-evaluated` for reason `not-supported`).
    ///
    /// Fails with `sdk/invalid-argument` for an unknown category, a category already in the
    /// decision, or a `pending` or `failed` decision.
    pub fn not_evaluated(mut self, category: &str) -> Result<Self> {
        let category = self.check_new(category)?;
        self.not_evaluated.push(category);
        Ok(self)
    }
    /// The known category named `category`, which must not be in this decision yet.
    fn check_new(&self, category: &str) -> Result<&'static str> {
        let Some(&known) = CATEGORIES.iter().find(|known| **known == category) else {
            return Err(invalid_argument(format!(
                "{category} is not a CalmLens category"
            )));
        };
        if !self.status.is_decided() {
            return Err(invalid_argument(format!(
                "a {} decision has no findings",
                self.status
            )));
        }
        if self.not_evaluated.contains(&known) || self.flags.iter().any(|f| f.category == known) {
            return Err(invalid_argument(format!(
                "{known} is already in this decision"
            )));
        }
        Ok(known)
    }
    fn score_of(&self, category: &str) -> f64 {
        self.flags
            .iter()
            .find(|flag| flag.category == category)
            .map_or(0.0, |flag| flag.score)
    }
    /// The categories the policy acts on.
    pub(super) fn flagged_categories(&self) -> Vec<&'static str> {
        CATEGORIES
            .iter()
            .copied()
            .filter(|category| !self.not_evaluated.contains(category))
            .filter(|category| self.action(self.score_of(category)) != "allow")
            .collect()
    }
    fn action(&self, score: f64) -> &'static str {
        if self.status != MockOutcome::Allowed && score >= 0.5 {
            self.status.action()
        } else {
            "allow"
        }
    }
    /// The moderation fields a decided asset gets (`categories`, `score` and `policy`), or
    /// `None` for `pending` and `failed`.
    pub(super) fn report(&self) -> Option<Map<String, Value>> {
        if !self.status.is_decided() {
            return None;
        }
        let evaluated: Vec<(&str, f64)> = CATEGORIES
            .iter()
            .filter(|category| !self.not_evaluated.contains(category))
            .map(|category| (*category, self.score_of(category)))
            .collect();
        let score = evaluated
            .iter()
            .map(|(_, score)| *score)
            .fold(0.0, f64::max);
        let mut categories = Map::new();
        for category in CATEGORIES {
            let result = if self.not_evaluated.contains(category) {
                json!({"status": "not-evaluated", "reason": "not-supported"})
            } else {
                let flag = self.flags.iter().find(|flag| flag.category == *category);
                let score = flag.map_or(0.0, |flag| flag.score);
                let mut result = json!({
                    "status": "evaluated", "likelihood": likelihood(score), "score": score,
                });
                if let Some(flag) = flag.filter(|flag| !flag.qualifiers.is_empty()) {
                    result["qualifiers"] = flag
                        .qualifiers
                        .iter()
                        .map(|(qualifier, some_score)| {
                            let result = json!({
                                "status": "evaluated", "someScore": some_score,
                                "likelihood": likelihood(*some_score),
                            });
                            ((*qualifier).to_owned(), result)
                        })
                        .collect::<Map<String, Value>>()
                        .into();
                }
                result
            };
            categories.insert((*category).to_owned(), result);
        }
        let policy_categories: Map<String, Value> = evaluated
            .iter()
            .map(|(category, score)| {
                let action = self.action(*score);
                (
                    (*category).to_owned(),
                    json!({"score": score, "action": action}),
                )
            })
            .collect();
        let action = (self.status != MockOutcome::Allowed).then(|| self.status.action());
        let policy = json!({
            "score": score,
            "categories": policy_categories,
            "evidence": "full",
            "decision": {
                "source": "policy", "action": action, "regions": [],
                "flaggedCategories": self.flagged_categories(),
            },
        });
        let mut report = Map::new();
        report.insert("categories".into(), categories.into());
        report.insert("score".into(), score.into());
        report.insert("policy".into(), policy);
        Some(report)
    }
}

/// Why the mock is moderating an asset, for [`MockOptions::moderate`](super::MockOptions::moderate).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MockModerationTrigger {
    /// An upload completed: `assets().create`, `assets().classify`, `text().classify` or a final
    /// part.
    Upload,
    /// `assets().retry` queued a failed asset again.
    Retry,
    /// `assets().explain` with `rerun` queued the asset again.
    Rerun,
    /// [`complete_processing`](super::MockServerClient::complete_processing) finished processing
    /// without a decision of its own.
    Complete,
}
impl MockModerationTrigger {
    /// `upload`, `retry`, `rerun` or `complete`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Retry => "retry",
            Self::Rerun => "rerun",
            Self::Complete => "complete",
        }
    }
}

/// An asset's content as the mock moderates it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct MockModerationContent {
    /// The uploaded bytes, parts joined in order; `None` without stored content, such as a
    /// website or removed content.
    pub bytes: Option<Vec<u8>>,
    /// The bytes as UTF-8 text when the asset is a `plaintext-document`.
    pub text: Option<String>,
}

/// What [`MockOptions::moderate`](super::MockOptions::moderate) receives for each asset the
/// mock moderates.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct MockModerationInput {
    /// The asset as stored, still processing.
    pub asset: Asset,
    /// Its content.
    pub content: MockModerationContent,
    /// Why it is being moderated.
    pub trigger: MockModerationTrigger,
    /// `true` when the API would queue the work rather than answer with the decision: queued
    /// uploads, retries, reruns and `complete`.
    pub queued: bool,
}
impl MockModerationInput {
    /// The decision the mock makes without a `moderate` callback: queued work other than
    /// `complete` stays `pending`, and everything else is `allowed`.
    pub fn default_decision(&self) -> MockDecision {
        if self.queued && self.trigger != MockModerationTrigger::Complete {
            MockOutcome::Pending.into()
        } else {
            MockOutcome::Allowed.into()
        }
    }
}

/// What a `moderate` callback may return: a [`MockOutcome`], a [`MockDecision`], or a
/// `calmlens::Result` of either, so a callback can use `?` on the builder. An error fails the
/// request that triggered the moderation with that error.
pub trait IntoMockDecision {
    /// The decision.
    fn into_mock_decision(self) -> Result<MockDecision>;
}
impl IntoMockDecision for MockDecision {
    fn into_mock_decision(self) -> Result<MockDecision> {
        Ok(self)
    }
}
impl IntoMockDecision for MockOutcome {
    fn into_mock_decision(self) -> Result<MockDecision> {
        Ok(self.into())
    }
}
impl<T: IntoMockDecision> IntoMockDecision for Result<T> {
    fn into_mock_decision(self) -> Result<MockDecision> {
        self?.into_mock_decision()
    }
}
