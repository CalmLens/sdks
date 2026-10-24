<?php
return [
    'api_key' => env('CALMLENS_API_KEY'),
    'project_id' => env('CALMLENS_PROJECT_ID'),
    'webhook_secret' => env('CALMLENS_WEBHOOK_SECRET'),
    // Leave unset for the hosted CalmLens; a local instance is http://localhost:6110/v1 and http://localhost:6130/v1.
    'api_url' => env('CALMLENS_API_URL') ?: 'https://api.calmlens.com/v1',
    'cdn_url' => env('CALMLENS_CDN_URL') ?: 'https://cdn.calmlens.com/v1',
];
