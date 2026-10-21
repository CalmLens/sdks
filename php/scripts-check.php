<?php
// Syntax-check package sources without a development tool dependency.
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . '/src'));
foreach ($iterator as $file) {
    if ($file->getExtension() === 'php') {
        passthru(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($file->getPathname()), $status);
        if ($status !== 0) {
            exit($status);
        }
    }
}
