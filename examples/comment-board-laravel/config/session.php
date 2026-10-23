<?php
return [
    'driver' => 'file', 'lifetime' => 120, 'encrypt' => false,
    'files' => storage_path('framework/sessions'), 'cookie' => 'calmlens_example_session',
    'path' => '/', 'domain' => null, 'secure' => null, 'http_only' => true, 'same_site' => 'lax',
];
