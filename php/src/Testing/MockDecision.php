<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Exception\InvalidArgumentException;
use CalmLens\SdkErrorCodes;

/**
 * A moderation decision for `MockServerClient`'s `moderate` callable or `completeProcessing`,
 * started with `MockDecision::of($status)`: flag the categories it found, with their scores and
 * qualifiers, mark the categories it couldn't assess, and optionally leave it waiting for human
 * review. Each call checks its names and scores and throws `InvalidArgumentException` (`sdk/invalid-argument`) for one CalmLens doesn't have.
 */
final class MockDecision
{
    /**
     * Where moderation leaves an asset: `pending` (still processing), `failed` (processing failed,
     * retryable), or a decision with that moderation status (`purged` also removes the content).
     */
    public const STATUSES = ['pending', 'failed', 'allowed', 'limited', 'age-restricted', 'blocked', 'purged'];
    /** The policy action that gives each decided status. */
    private const ACTIONS = ['allowed' => 'allow', 'limited' => 'limit', 'age-restricted' => 'age-restrict', 'blocked' => 'block', 'purged' => 'purge'];

    /** @var array<string, array{score: int|float, qualifiers: array<string, int|float>}> */
    private array $flags = [];
    /** @var array<string, true> */
    private array $notEvaluated = [];
    /** @var ?array{reason: string, uncertainCategories: list<string>} */
    private ?array $pendingReview = null;

    private function __construct(public readonly string $status)
    {
    }

    /** Starts a decision with this status: one of `STATUSES`. */
    public static function of(string $status): self
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw self::invalid('status must be one of ' . implode(', ', self::STATUSES) . " (got $status)");
        }
        return new self($status);
    }

    /**
     * Records findings in `$category` with its `$score` (0 to 1) and, optionally, scores for its
     * qualifiers, such as `['violence-threat' => 0.9]`. The policy acts on a category at 0.5 and
     * above, so `flaggedCategories` lists it there unless the status is `allowed`.
     *
     * @param array<string, int|float> $qualifiers
     */
    public function flag(string $category, int|float $score, array $qualifiers = []): self
    {
        $this->checkFinding($category);
        if (!self::isScore($score)) {
            throw self::invalid("$category's score must be from 0 to 1");
        }
        foreach ($qualifiers as $qualifier => $qualifierScore) {
            if (!in_array($qualifier, Classification::QUALIFIERS[$category], true)) {
                throw self::invalid("$qualifier is not a qualifier of $category");
            }
            if (!self::isScore($qualifierScore)) {
                throw self::invalid("$qualifier's score must be from 0 to 1");
            }
        }
        $this->flags[$category] = ['score' => $score, 'qualifiers' => $qualifiers];
        return $this;
    }

    /** Marks `$category` as not assessed (`not-evaluated` for reason `not-supported`). */
    public function notEvaluated(string $category): self
    {
        $this->checkFinding($category);
        $this->notEvaluated[$category] = true;
        return $this;
    }

    /**
     * Leaves the decision waiting for human review, as `classification.moderation.pendingReview`
     * reports: `sampled`, or `uncertain` with the `$uncertainCategories` that made it so. The
     * reviewer's decision (`decide` on the mock) clears it; `assets->decide` doesn't, as with the API.
     *
     * @param list<string> $uncertainCategories
     */
    public function pendingReview(string $reason, array $uncertainCategories = []): self
    {
        if (!isset(self::ACTIONS[$this->status])) {
            throw self::invalid("a {$this->status} decision can't wait for review");
        }
        if ($reason !== 'sampled' && $reason !== 'uncertain') {
            throw self::invalid('reason must be sampled or uncertain');
        }
        if ($reason === 'sampled' && $uncertainCategories !== []) {
            throw self::invalid('a sampled review has no uncertain categories');
        }
        foreach ($uncertainCategories as $category) {
            if (!in_array($category, Classification::CATEGORIES, true)) {
                throw self::invalid(json_encode($category) . ' is not a CalmLens category');
            }
        }
        $this->pendingReview = ['reason' => $reason, 'uncertainCategories' => array_values($uncertainCategories)];
        return $this;
    }

    /**
     * The report a decided asset gets, as the API sends it: every category (unflagged ones
     * evaluated with score 0), the policy-adjusted results, the automated status and
     * `flaggedCategories`. `$requestedAt` is when a pending review joined the queue. Null for
     * `pending` and `failed`.
     *
     * @return ?array{raw: array, categories: array, flaggedCategories: list<string>, pendingReview: ?array}
     */
    public function report(int $requestedAt = 0): ?array
    {
        $status = $this->status;
        if (!isset(self::ACTIONS[$status])) {
            return null;
        }
        $action = fn (int|float $score): string => $status !== 'allowed' && $score >= 0.5 ? self::ACTIONS[$status] : 'allow';
        $categories = [];
        $evaluated = [];
        foreach (Classification::CATEGORIES as $category) {
            if (isset($this->notEvaluated[$category])) {
                $categories[$category] = ['status' => 'not-evaluated', 'reason' => 'not-supported'];
                continue;
            }
            $flag = $this->flags[$category] ?? ['score' => 0, 'qualifiers' => []];
            $evaluated[$category] = $flag['score'];
            $categories[$category] = ['status' => 'evaluated', 'likelihood' => self::likelihood($flag['score']), 'score' => $flag['score']];
            foreach ($flag['qualifiers'] as $qualifier => $someScore) {
                $categories[$category]['qualifiers'][$qualifier] = ['status' => 'evaluated', 'someScore' => $someScore, 'likelihood' => self::likelihood($someScore)];
            }
        }
        $flagged = array_keys(array_filter($evaluated, fn ($score) => $action($score) !== 'allow'));
        return ['raw' => ['categories' => $categories, 'hashMatches' => []],
            'categories' => array_map(fn ($score) => ['score' => $score, 'action' => $action($score),
                'source' => ['kind' => $score >= 0.5 ? 'default' : 'below-threshold'],
                // The mock keeps no policies: the category's setting is the decision's own action.
                'settings' => ['action' => self::ACTIONS[$status], 'allowances' => [], 'restrictions' => []]], $evaluated),
            // The mock keeps no policies, so no policy is named.
            'explanationComplete' => true, 'policy' => null,
            'pendingReview' => $this->pendingReview === null ? null : ['requestedAt' => $requestedAt] + $this->pendingReview,
            'source' => 'policy', 'rule' => null, 'automatedStatus' => $status, 'linkSafety' => null,
            // The mock analyses no audio or video, so a decision has no findings timeline.
            'regions' => [], 'timeline' => null, 'flaggedCategories' => $flagged];
    }

    /** The likelihood the API reports for a score. */
    private static function likelihood(int|float $score): string
    {
        return match (true) {
            $score >= 0.8 => 'very-likely',
            $score >= 0.6 => 'likely',
            $score >= 0.4 => 'possible',
            $score >= 0.2 => 'unlikely',
            default => 'very-unlikely',
        };
    }

    private static function isScore(mixed $score): bool
    {
        return (is_int($score) || is_float($score)) && is_finite((float) $score) && $score >= 0 && $score <= 1;
    }

    private function checkFinding(string $category): void
    {
        if (!in_array($category, Classification::CATEGORIES, true)) {
            throw self::invalid("$category is not a CalmLens category");
        }
        if (!isset(self::ACTIONS[$this->status])) {
            throw self::invalid("a {$this->status} decision has no findings");
        }
        if (isset($this->flags[$category]) || isset($this->notEvaluated[$category])) {
            throw self::invalid("$category is already in this decision");
        }
    }

    /** A status or a decision as a checked `MockDecision`. */
    public static function from(mixed $value): self
    {
        return match (true) {
            $value instanceof self => $value,
            is_string($value) => self::of($value),
            default => throw self::invalid('a decision must be a status or a MockDecision'),
        };
    }

    private static function invalid(string $message): InvalidArgumentException
    {
        return new InvalidArgumentException(SdkErrorCodes::INVALID_ARGUMENT, $message);
    }
}
