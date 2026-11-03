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

// Packagist installs calmlens/sdk from the repository root (../composer.json and ../.gitattributes).
// Its manifest must describe this package, and its archives must hold only the package.
$package = json_decode(file_get_contents(__DIR__ . '/composer.json'), true, flags: JSON_THROW_ON_ERROR);
$root = json_decode(file_get_contents(__DIR__ . '/../composer.json'), true, flags: JSON_THROW_ON_ERROR);
foreach (['name', 'description', 'type', 'license', 'require'] as $key) {
    if (($root[$key] ?? null) !== ($package[$key] ?? null)) {
        fwrite(STDERR, "../composer.json $key differs from composer.json\n");
        exit(1);
    }
}
if (($root['autoload'] ?? null) !== ['psr-4' => ['CalmLens\\' => 'php/src/']]) {
    fwrite(STDERR, "../composer.json must autoload CalmLens\\ from php/src/\n");
    exit(1);
}
exec('git -C ' . escapeshellarg(dirname(__DIR__)) . ' archive --worktree-attributes --format=tar HEAD | tar -t', $files, $status);
if ($status !== 0) {
    fwrite(STDERR, "Could not list the repository archive\n");
    exit(1);
}
$allowed = '#^(composer\.json|LICENSE|README\.md|php/|php/(CHANGELOG\.md|LICENSE|README\.md)|php/src/.*)$#';
foreach ($files as $file) {
    if (!preg_match($allowed, $file)) {
        fwrite(STDERR, "The Packagist archive includes $file; add it to ../.gitattributes as export-ignore\n");
        exit(1);
    }
}
