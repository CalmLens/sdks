<?php

declare(strict_types=1);

namespace CalmLens\Model;

/** The values of the API's moderation categories. */
final class Category
{
    public const SEXUAL = 'sexual';
    public const VIOLENCE = 'violence';
    public const SELF_HARM = 'self-harm';
    public const HARASSMENT = 'harassment';
    public const HATE = 'hate';
    public const CRIMINAL_ACTIVITY = 'criminal-activity';
    public const PERSONAL_INFORMATION = 'personal-information';
    public const PROFANITY = 'profanity';

    private function __construct() {}
}
