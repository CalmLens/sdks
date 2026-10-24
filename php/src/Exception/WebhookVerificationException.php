<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** A webhook delivery failed verification (`sdk/invalid-webhook-signature`) or was not an event payload (`sdk/invalid-webhook-payload`). Respond with 400. */
class WebhookVerificationException extends \CalmLens\CalmLensException
{
}
