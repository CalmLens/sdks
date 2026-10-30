<?php

declare(strict_types=1);

namespace CalmLens\Exception;

/** A webhook delivery failed verification (`sdk/invalid-webhook-signature`: respond with 401) or was not an event payload (`sdk/invalid-webhook-payload`: respond with 400). */
class WebhookVerificationException extends \CalmLens\CalmLensException
{
}
