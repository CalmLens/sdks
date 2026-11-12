<?php

declare(strict_types=1);

use CalmLens\CalmLensObject;
use CalmLens\Collection;
use CalmLens\Model\Asset;
use CalmLens\Model\AssetClassification;
use CalmLens\Model\CategoryResult;
use CalmLens\Model\Event;
use CalmLens\Model\Folder;
use CalmLens\Testing\MockTransport;
use PHPStan\PhpDocParser\Ast\Type\ObjectShapeNode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/TypeContract.php';

/** API objects: field access, nested models, unknown fields, read-only values, JSON and paging. */
final class ObjectsTest extends TestCase
{
    private const ASSET = [
        'id' => 'asset-1', 'type' => 'image', 'futureField' => ['added' => true],
        'classification' => ['status' => 'completed', 'moderation' => ['status' => 'allowed',
            'raw' => ['categories' => ['self-harm' => ['status' => 'not-evaluated', 'reason' => 'unavailable']], 'hashMatches' => []],
            'categories' => []]],
        'metadata' => [['id' => 'campaign.id', 'value' => ['nested' => 'json']]],
    ];

    public function testFieldsReadAsPropertiesAndKeysWithNestedModels(): void
    {
        $asset = Asset::constructFrom(self::ASSET);
        self::assertSame('asset-1', $asset->id);
        self::assertSame('asset-1', $asset['id']);
        self::assertInstanceOf(AssetClassification::class, $asset->classification);
        self::assertSame(Asset::TYPE_IMAGE, $asset->type);
        self::assertSame('completed', $asset['classification']['status']);
        $category = $asset->classification->moderation->raw->categories['self-harm'];
        self::assertInstanceOf(CategoryResult::class, $category);
        self::assertSame(CategoryResult::REASON_UNAVAILABLE, $category->reason);
        // Open JSON values stay as they were decoded.
        self::assertSame(['nested' => 'json'], $asset->metadata[0]->value);
        self::assertNull($asset->name);
        self::assertFalse(isset($asset->name));
        self::assertTrue(isset($asset['futureField']));
    }

    public function testUnknownFieldsAreKeptAndToArrayGivesBackTheDecodedJson(): void
    {
        $asset = Asset::constructFrom(self::ASSET);
        self::assertSame(['added' => true], $asset->futureField);
        self::assertSame(self::ASSET, $asset->toArray());
        self::assertSame(array_keys(self::ASSET), $asset->keys());
        self::assertCount(count(self::ASSET), $asset);
        self::assertSame(array_keys(self::ASSET), array_keys(iterator_to_array($asset)));
    }

    public function testJsonKeepsEmptyObjectsAndRecordsAsObjects(): void
    {
        $asset = Asset::constructFrom(['id' => 'a', 'upload' => [], 'classification' => ['moderation' => ['categories' => []]]]);
        self::assertSame('{"id":"a","upload":{},"classification":{"moderation":{"categories":{}}}}', json_encode($asset));
    }

    public function testObjectsAreReadOnly(): void
    {
        $folder = Folder::constructFrom(['id' => 'folder-1']);
        foreach ([fn () => $folder->name = 'x', fn () => $folder['name'] = 'x', function () use ($folder) { unset($folder->id); },
            function () use ($folder) { unset($folder['id']); }] as $change) {
            try {
                $change();
                self::fail('Expected a read-only object');
            } catch (LogicException) {
            }
        }
        self::assertSame(['id' => 'folder-1'], $folder->toArray());
    }

    public function testAutoPagingFetchesLaterPagesWithTheSameParams(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['items' => [['id' => 'f1']], 'nextCursor' => 'c2', 'hasMore' => true, 'ancestors' => []])
            ->enqueueJson(['items' => [['id' => 'f2']], 'nextCursor' => null, 'hasMore' => false, 'ancestors' => []]);
        $page = $mock->client()->folders->list(['parentId' => 'parent', 'pageSize' => 1]);
        self::assertCount(1, $page);
        self::assertSame(['f1'], array_map(fn (Folder $folder) => $folder->id, iterator_to_array($page)));
        self::assertSame(['f1', 'f2'], array_map(fn (Folder $folder) => $folder->id, iterator_to_array($page->autoPagingIterator(), false)));
        $queries = array_map(fn ($recorded) => $recorded->request->getUri()->getQuery(), $mock->requests());
        self::assertSame(['parentId=parent&pageSize=1', 'parentId=parent&pageSize=1&cursor=c2'], $queries);
    }

    public function testAutoPagingStopsAtARepeatedCursor(): void
    {
        $mock = new MockTransport();
        $mock->enqueueJson(['items' => [['id' => 'f1']], 'nextCursor' => 'c', 'hasMore' => true, 'ancestors' => []])
            ->enqueueJson(['items' => [['id' => 'f2']], 'nextCursor' => 'c', 'hasMore' => true, 'ancestors' => []]);
        $seen = [];
        try {
            foreach ($mock->client()->folders->each() as $folder) {
                $seen[] = $folder->id;
            }
            self::fail('Expected sdk/invalid-response');
        } catch (\CalmLens\CalmLensException $error) {
            self::assertSame('sdk/invalid-response', $error->errorCode);
            self::assertSame(['cursor' => 'c'], $error->details);
        }
        self::assertSame(['f1'], $seen);
    }

    public function testEventFeedPagesContinueThroughEmptyPagesWhileMoreFollow(): void
    {
        $mock = new MockTransport();
        $event = ['id' => 'e1', 'projectId' => 'p', 'type' => 'asset.allowed', 'createdAt' => 1, 'facts' => [['key' => 'test', 'value' => true]]];
        $mock->enqueueJson(['items' => [], 'nextCursor' => 'c2', 'hasMore' => true])
            ->enqueueJson(['items' => [$event], 'nextCursor' => 'c3', 'hasMore' => false]);
        $events = iterator_to_array($mock->client()->events->each(['cursor' => 'c1']), false);
        self::assertCount(1, $events);
        self::assertInstanceOf(Event::class, $events[0]);
        self::assertSame(Event::TYPE_ASSET_ALLOWED, $events[0]->type);
        self::assertSame('test', $events[0]->facts[0]->key);
    }

    /** @return iterable<string, array{class-string<CalmLensObject>}> */
    public static function models(): iterable
    {
        foreach (glob(__DIR__ . '/../src/Model/*.php') as $file) {
            $class = 'CalmLens\\Model\\' . basename($file, '.php');
            if (is_subclass_of($class, CalmLensObject::class)) {
                yield basename($file, '.php') => [$class];
            }
        }
    }

    /**
     * A model's `FIELDS` names exactly the nested model of each property its docblock types as one:
     * a class, a `list` of them, or an array keyed by name.
     */
    #[DataProvider('models')]
    public function testFieldsMatchThePropertyDocblocks(string $class): void
    {
        $reflection = new ReflectionClass($class);
        $resolver = new DeclaredTypes([]);
        $expected = [];
        foreach (TypeContract::docblock($reflection->getDocComment())->getPropertyReadTagValues() as $tag) {
            $field = self::nestedModel($tag->type, $reflection, $resolver);
            if ($field !== null) {
                $expected[ltrim($tag->propertyName, '$')] = $field;
            }
        }
        $fields = $reflection->getReflectionConstant('FIELDS')->getValue();
        if (is_subclass_of($class, Collection::class)) {
            unset($expected['items'], $fields['items']);
        }
        ksort($expected);
        ksort($fields);
        self::assertSame($expected, $fields);
    }

    private static function nestedModel(mixed $type, ReflectionClass $scope, DeclaredTypes $resolver): mixed
    {
        foreach ($type instanceof PHPStan\PhpDocParser\Ast\Type\UnionTypeNode ? $type->types : [$type] as $member) {
            if ($member instanceof PHPStan\PhpDocParser\Ast\Type\IdentifierTypeNode && $resolver->resolve($member, $scope) instanceof ObjectShapeNode) {
                return $scope->getNamespaceName() . '\\' . $member->name;
            }
            if ($member instanceof PHPStan\PhpDocParser\Ast\Type\GenericTypeNode) {
                $item = self::nestedModel(end($member->genericTypes), $scope, $resolver);
                if ($item !== null) {
                    return $member->type->name === 'list' ? [$item] : ['*' => $item];
                }
            }
        }
        return null;
    }
}
