<?php

declare(strict_types=1);

use CalmLens\CalmLensObject;
use PHPStan\PhpDocParser\Ast\ConstExpr\ConstExprIntegerNode;
use PHPStan\PhpDocParser\Ast\ConstExpr\ConstFetchNode;
use PHPStan\PhpDocParser\Ast\ConstExpr\ConstExprStringNode;
use PHPStan\PhpDocParser\Ast\PhpDoc\InvalidTagValueNode;
use PHPStan\PhpDocParser\Ast\PhpDoc\PhpDocNode;
use PHPStan\PhpDocParser\Ast\Type\ArrayShapeItemNode;
use PHPStan\PhpDocParser\Ast\Type\ArrayShapeNode;
use PHPStan\PhpDocParser\Ast\Type\ArrayTypeNode;
use PHPStan\PhpDocParser\Ast\Type\ConstTypeNode;
use PHPStan\PhpDocParser\Ast\Type\GenericTypeNode;
use PHPStan\PhpDocParser\Ast\Type\IdentifierTypeNode;
use PHPStan\PhpDocParser\Ast\Type\IntersectionTypeNode;
use PHPStan\PhpDocParser\Ast\Type\NullableTypeNode;
use PHPStan\PhpDocParser\Ast\Type\ObjectShapeItemNode;
use PHPStan\PhpDocParser\Ast\Type\ObjectShapeNode;
use PHPStan\PhpDocParser\Ast\Type\TypeNode;
use PHPStan\PhpDocParser\Ast\Type\UnionTypeNode;
use PHPStan\PhpDocParser\Lexer\Lexer;
use PHPStan\PhpDocParser\Parser\ConstExprParser;
use PHPStan\PhpDocParser\Parser\PhpDocParser;
use PHPStan\PhpDocParser\Parser\TokenIterator;
use PHPStan\PhpDocParser\Parser\TypeParser;
use PHPStan\PhpDocParser\ParserConfig;

/**
 * Compares a method's declared PHPStan types with the JSON Schema of the operation in
 * types.json, and names every difference as `$.<path>: <problem>`: its `@param ... $params` array
 * shape, and the `@property-read` docblocks of the model class its `@return` names.
 * packages/sdk-contract/README.md, "Declared types", has the rules. `DeclaredTypes` first resolves
 * a docblock type into plain nodes: aliases, model classes (as object shapes),
 * `Collection<Item>` and constant wildcards such as `self::STATUS_*`.
 *
 * Two PHP conventions apply to model objects. A field the API may leave out reads as null, so it
 * is declared nullable rather than optional. A union of object branches is one class holding
 * every branch's fields (stripe-php's convention for variants), so it is compared with the
 * branches merged: a field only some branches have may be left out, and the tag is an enum.
 */
final class TypeContract
{
    /** @var list<string> */
    public array $problems = [];

    /** @param array<string, TypeNode> $aliases */
    private function __construct(private array $definitions, private array $aliases, private bool $exactNull) {}

    public static function docblock(string|false $comment): PhpDocNode
    {
        $config = new ParserConfig([]);
        $constants = new ConstExprParser($config);
        $parser = new PhpDocParser($config, new TypeParser($config, $constants), $constants);
        return $parser->parse(new TokenIterator((new Lexer($config))->tokenize($comment ?: '/** */')));
    }

    /** @return array<string, TypeNode> the `@phpstan-type` aliases each class declares. */
    public static function aliases(string ...$classes): array
    {
        $aliases = [];
        foreach ($classes as $class) {
            foreach (self::docblock((new ReflectionClass($class))->getDocComment())->getTypeAliasTagValues() as $alias) {
                $aliases[$alias->alias] = $alias->type;
            }
        }
        return $aliases;
    }

    /**
     * The differences between `$declared` and the operation's options (`properties`, `required`),
     * ignoring the keys `$native` lists, which the SDK takes besides the API's fields.
     *
     * @param list<string> $native
     * @return list<string>
     */
    public static function options(TypeNode $declared, array $options, array $native, bool $patch, array $definitions, array $aliases): array
    {
        $contract = new self($definitions, $aliases, $patch);
        $schema = ['type' => 'object', 'properties' => array_map(fn (array $property) => $property['schema'], $options['properties']),
            'required' => $options['required']];
        $contract->compare($declared, $schema, '$', [], $native);
        return $contract->problems;
    }

    /** @return list<string> */
    public static function result(TypeNode $declared, array $schema, array $definitions, array $aliases): array
    {
        $contract = new self($definitions, $aliases, true);
        $contract->compare($declared, $schema, '$', []);
        return $contract->problems;
    }

    private function problem(string $path, string $problem): void
    {
        $this->problems[] = "$path: $problem";
    }

    /**
     * The schema's branches, `$ref`s resolved and nested unions flattened: [branches, nullable,
     * open, recursive]. `$inside` names the references the walk is already in.
     */
    private function branches(array $schema, array &$inside): array
    {
        if (isset($schema['$ref'])) {
            $name = substr($schema['$ref'], strlen('#/definitions/'));
            if (in_array($name, $inside, true)) {
                return [[], false, false, true];
            }
            $inside[] = $name;
            return $this->branches($this->definitions[$name], $inside);
        }
        $union = $schema['anyOf'] ?? $schema['oneOf'] ?? null;
        if ($union !== null) {
            $all = [[], false, false, false];
            foreach ($union as $branch) {
                [$branches, $nullable, $open, $recursive] = $this->branches($branch, $inside);
                $all = [[...$all[0], ...$branches], $all[1] || $nullable, $all[2] || $open, $all[3] || $recursive];
            }
            return $all;
        }
        $types = (array) ($schema['type'] ?? (isset($schema['const']) || isset($schema['enum']) ? 'string' : []));
        if ($types === []) {
            return [[], false, true, false];
        }
        $branches = [];
        foreach ($types as $type) {
            if ($type !== 'null') {
                $branches[] = ['type' => $type] + $schema;
            }
        }
        return [$branches, in_array('null', $types, true), false, false];
    }

    /** The declared type's members, aliases resolved and unions flattened. */
    private function members(TypeNode $type): array
    {
        if ($type instanceof IdentifierTypeNode && isset($this->aliases[$type->name])) {
            return $this->members($this->aliases[$type->name]);
        }
        if ($type instanceof UnionTypeNode) {
            return array_merge(...array_map($this->members(...), $type->types));
        }
        if ($type instanceof NullableTypeNode) {
            return [new IdentifierTypeNode('null'), ...$this->members($type->type)];
        }
        return [$type];
    }

    /** A declared member's kind: null, mixed, string, integer, number, boolean, array, object or the type itself. */
    private static function kind(TypeNode $member): string
    {
        if ($member instanceof ConstTypeNode) {
            return $member->constExpr instanceof ConstExprStringNode ? 'string' : ($member->constExpr instanceof ConstExprIntegerNode ? 'integer' : (string) $member);
        }
        if ($member instanceof ObjectShapeNode) {
            return 'object';
        }
        if ($member instanceof ArrayShapeNode) {
            return in_array($member->kind, [ArrayShapeNode::KIND_LIST, ArrayShapeNode::KIND_NON_EMPTY_LIST], true) ? 'array' : 'object';
        }
        if ($member instanceof ArrayTypeNode) {
            return 'array';
        }
        if ($member instanceof GenericTypeNode) {
            $name = $member->type->name;
            if (in_array($name, ['list', 'non-empty-list'], true)) {
                return 'array';
            }
            if (in_array($name, ['array', 'non-empty-array'], true)) {
                // array<int, V> is a list; array<string, V> and array<'a'|'b', V> are records.
                return count($member->genericTypes) === 2 && (string) $member->genericTypes[0] === 'int' ? 'array' : 'object';
            }
        }
        if ($member instanceof IdentifierTypeNode) {
            return match ($member->name) {
                'null' => 'null',
                'mixed' => 'mixed',
                'string', 'non-empty-string' => 'string',
                'int', 'positive-int', 'non-negative-int' => 'integer',
                'float' => 'number',
                'bool', 'true', 'false' => 'boolean',
                'list', 'non-empty-list' => 'array',
                'array' => 'object',
                default => $member->name,
            };
        }
        return (string) $member;
    }

    /** @param list<string> $native keys of the root options the API lacks but the SDK takes */
    private function compare(TypeNode $declared, array $schema, string $path, array $inside, array $native = []): void
    {
        [$branches, $nullable, $open, $recursive] = $this->branches($schema, $inside);
        if ($recursive) {
            return; // A reference the walk is already inside.
        }
        $members = $this->members($declared);
        $kinds = array_map(self::kind(...), $members);
        if ($open) {
            if (!in_array('mixed', $kinds, true)) {
                $this->problem($path, 'should be mixed, the API takes any value');
            }
            return;
        }
        if (in_array('mixed', $kinds, true)) {
            $this->problem($path, 'is mixed, the API has a type');
            return;
        }
        $declaredNull = in_array('null', $kinds, true);
        if ($declaredNull && !$nullable) {
            $this->problem($path, 'nullable, the API never allows null');
        } elseif ($nullable && !$declaredNull && $this->exactNull) {
            $this->problem($path, 'not nullable, the API allows null');
        }
        $byKind = [];
        foreach ($branches as $branch) {
            $byKind[$branch['type']][] = $branch;
        }
        if (isset($byKind['integer'], $byKind['number'])) {
            unset($byKind['integer']);
        }
        $declaredByKind = [];
        foreach ($members as $i => $member) {
            if ($kinds[$i] !== 'null') {
                $declaredByKind[$kinds[$i]][] = $member;
            }
        }
        // An integer may be declared as int, float or both.
        if (isset($byKind['integer']) && !isset($declaredByKind['integer']) && isset($declaredByKind['number'])) {
            $declaredByKind['integer'] = $declaredByKind['number'];
            unset($declaredByKind['number']);
        }
        if (isset($byKind['integer'], $declaredByKind['integer'], $declaredByKind['number'])) {
            unset($declaredByKind['number']);
        }
        // A number is int|float in PHP: JSON numbers without a fraction decode as int.
        if (isset($byKind['number'], $declaredByKind['number'], $declaredByKind['integer'])) {
            unset($declaredByKind['integer']);
        }
        foreach ($byKind as $kind => $kindBranches) {
            if (!isset($declaredByKind[$kind])) {
                $this->problem($path, match ($kind) {
                    'number' => isset($declaredByKind['integer']) ? 'should accept fractions (float)' : 'should be a number',
                    default => "should be " . (in_array($kind, ['array', 'object', 'integer'], true) ? "an $kind" : "a $kind"),
                });
                continue;
            }
            $declaredMembers = $declaredByKind[$kind];
            match ($kind) {
                'string' => $this->compareLiterals($declaredMembers, $kindBranches, $path),
                'boolean' => $this->compareBooleans($declaredMembers, $kindBranches, $path),
                'array' => $this->compareArrays($declaredMembers, $kindBranches, $path, $inside),
                'object' => $this->compareObjects($declaredMembers, $kindBranches, $path, $inside, $native),
                default => null,
            };
        }
        foreach (array_keys($declaredByKind) as $kind) {
            if (($kind === 'number' && isset($byKind['integer'])) || ($kind === 'integer' && isset($byKind['number']))) {
                continue;
            }
            if (!isset($byKind[$kind])) {
                $this->problem($path, 'accepts ' . match ($kind) {
                    'integer', 'array', 'object' => "an $kind",
                    'string', 'boolean', 'number' => "a $kind",
                    default => $kind,
                } . ', which the API does not');
            }
        }
    }

    /** String literals: an open string on either side, or exactly the same values. */
    private function compareLiterals(array $declared, array $branches, string $path): void
    {
        $expected = [];
        $openSchema = false;
        foreach ($branches as $branch) {
            if (array_key_exists('const', $branch)) {
                $expected[] = $branch['const'];
            } elseif (isset($branch['enum'])) {
                array_push($expected, ...$branch['enum']);
            } else {
                $openSchema = true;
            }
        }
        $listed = [];
        $openDeclared = false;
        foreach ($declared as $member) {
            if ($member instanceof ConstTypeNode && $member->constExpr instanceof ConstExprStringNode) {
                $listed[] = $member->constExpr->value;
            } else {
                $openDeclared = true;
            }
        }
        if ($openSchema) {
            if (!$openDeclared) {
                $this->problem($path, 'lists only ' . implode('|', $listed) . ', the API takes any string');
            }
            return;
        }
        if ($openDeclared) {
            $this->problem($path, 'is an open string, the API lists ' . implode('|', $expected));
            return;
        }
        foreach (array_diff($expected, $listed) as $value) {
            $this->problem($path, "does not accept $value");
        }
        foreach (array_diff($listed, $expected) as $value) {
            $this->problem($path, "lists $value, which the API lacks");
        }
    }

    private function compareBooleans(array $declared, array $branches, string $path): void
    {
        $expected = [];
        foreach ($branches as $branch) {
            array_push($expected, ...(array_key_exists('const', $branch) ? [$branch['const']] : [true, false]));
        }
        $listed = [];
        foreach ($declared as $member) {
            $name = (string) $member;
            array_push($listed, ...($name === 'true' ? [true] : ($name === 'false' ? [false] : [true, false])));
        }
        $same = fn (array $values) => array_values(array_unique(array_map('json_encode', $values)));
        $expected = $same($expected);
        $listed = $same($listed);
        sort($expected);
        sort($listed);
        if ($expected !== $listed) {
            $this->problem($path, 'should be ' . (count($expected) === 2 ? 'a boolean' : $expected[0]) . ', not ' . implode('|', array_map('strval', $declared)));
        }
    }

    private function compareArrays(array $declared, array $branches, string $path, array $inside): void
    {
        $items = [];
        foreach ($declared as $member) {
            $items[] = match (true) {
                $member instanceof ArrayTypeNode => $member->type,
                $member instanceof GenericTypeNode => $member->genericTypes[count($member->genericTypes) - 1],
                default => new IdentifierTypeNode('mixed'),
            };
        }
        $item = count($items) === 1 ? $items[0] : new UnionTypeNode($items);
        $schemaItems = array_map(fn (array $branch) => $branch['items'] ?? [], $branches);
        $this->compare($item, count($schemaItems) === 1 ? $schemaItems[0] : ['anyOf' => $schemaItems], $path . '[]', $inside);
    }

    /** The key whose constant tags each object branch: `type`, `key`, or another constant they all have. */
    private static function tag(array $branches): ?string
    {
        if (count($branches) < 2) {
            return null;
        }
        $candidates = array_keys($branches[0]['properties'] ?? []);
        usort($candidates, fn ($a, $b) => (int) in_array($b, ['type', 'key'], true) <=> (int) in_array($a, ['type', 'key'], true));
        foreach ($candidates as $key) {
            $values = array_map(fn (array $branch) => $branch['properties'][$key]['const'] ?? null, $branches);
            if (!in_array(null, $values, true) && count(array_unique($values)) === count($values)) {
                return $key;
            }
        }
        return null;
    }

    private function compareObjects(array $declared, array $branches, string $path, array $inside, array $native): void
    {
        $tag = self::tag($branches);
        // A model class holds every branch of a union: compare it with the branches merged.
        if ($tag !== null && count($declared) === 1 && $declared[0] instanceof ObjectShapeNode) {
            $merged = self::mergeSchemas($branches);
            $merged['properties'][$tag] = ['enum' => array_map(fn (array $branch) => $branch['properties'][$tag]['const'], $branches), 'type' => 'string'];
            $this->compareObject($declared[0], $merged, $path, $inside, $native);
            return;
        }
        if ($tag !== null) {
            $declaredByTag = [];
            foreach ($declared as $member) {
                $value = null;
                foreach ($member instanceof ArrayShapeNode ? $member->items : [] as $item) {
                    if (self::key($item) === $tag && $item->valueType instanceof ConstTypeNode && $item->valueType->constExpr instanceof ConstExprStringNode) {
                        $value = $item->valueType->constExpr->value;
                    }
                }
                if ($value === null) {
                    $this->problem($path, "declares a branch without a constant `$tag`");
                    continue;
                }
                $declaredByTag[$value] = $member;
            }
            foreach ($branches as $branch) {
                $value = $branch['properties'][$tag]['const'];
                if (!isset($declaredByTag[$value])) {
                    $this->problem("$path<$value>", 'missing');
                    continue;
                }
                $this->compareObject($declaredByTag[$value], $branch, "$path<$value>", $inside, []);
                unset($declaredByTag[$value]);
            }
            foreach (array_keys($declaredByTag) as $value) {
                $this->problem("$path<$value>", 'not in the API');
            }
            return;
        }
        $this->compareObject(count($declared) === 1 ? $declared[0] : self::merge($declared), self::mergeSchemas($branches), $path, $inside, $native);
    }

    /** Untagged object branches as one: each key's types from every branch, optional unless every branch requires it. */
    private static function mergeSchemas(array $branches): array
    {
        if (count($branches) === 1) {
            return $branches[0];
        }
        $properties = [];
        $counts = [];
        foreach ($branches as $branch) {
            foreach ($branch['properties'] ?? [] as $key => $property) {
                $properties[$key][] = $property;
                $counts[$key] = ($counts[$key] ?? 0) + (in_array($key, $branch['required'] ?? [], true) ? 1 : 0);
            }
        }
        return ['type' => 'object',
            'properties' => array_map(fn (array $schemas) => count($schemas) === 1 ? $schemas[0] : ['anyOf' => $schemas], $properties),
            'required' => array_keys(array_filter($counts, fn (int $count) => $count === count($branches)))];
    }

    private static function merge(array $declared): TypeNode
    {
        $shapes = array_filter($declared, fn ($member) => $member instanceof ArrayShapeNode);
        if (count($shapes) !== count($declared)) {
            return $declared[0];
        }
        $values = [];
        $counts = [];
        foreach ($shapes as $shape) {
            foreach ($shape->items as $item) {
                $values[self::key($item)][] = $item->valueType;
                $counts[self::key($item)] = ($counts[self::key($item)] ?? 0) + ($item->optional ? 0 : 1);
            }
        }
        $items = [];
        foreach ($values as $key => $types) {
            $items[] = new ArrayShapeItemNode(new IdentifierTypeNode($key), $counts[$key] !== count($shapes),
                count($types) === 1 ? $types[0] : new UnionTypeNode($types));
        }
        return ArrayShapeNode::createSealed($items);
    }

    private static function key(ArrayShapeItemNode|ObjectShapeItemNode $item): string
    {
        $key = $item->keyName;
        return $key instanceof ConstExprStringNode ? $key->value : (string) $key;
    }

    private function compareObject(TypeNode $declared, array $schema, string $path, array $inside, array $native): void
    {
        if (!isset($schema['properties'])) {
            $values = $schema['additionalProperties'] ?? [];
            if ($values === [] || $values === true) {
                return; // An open record, such as transform options: any declared object fits.
            }
            if (!$declared instanceof GenericTypeNode) {
                $this->problem($path, 'should be a record, array<' . (isset($schema['propertyNames']['enum']) ? 'key' : 'string') . ', value>');
                return;
            }
            if (isset($schema['propertyNames'])) {
                $this->compare($declared->genericTypes[0], $schema['propertyNames'], $path . '{key}', $inside);
            }
            $this->compare($declared->genericTypes[count($declared->genericTypes) - 1], $values, $path . '{}', $inside);
            return;
        }
        if ($declared instanceof GenericTypeNode && count($declared->genericTypes) === 2) {
            // Keys a PHP property can't have, such as `self-harm`: an array keyed by them.
            $keys = [];
            foreach ($this->members($declared->genericTypes[0]) as $member) {
                if ($member instanceof ConstTypeNode && $member->constExpr instanceof ConstExprStringNode) {
                    $keys[] = $member->constExpr->value;
                }
            }
            foreach ($schema['properties'] as $key => $property) {
                if (!in_array($key, $keys, true)) {
                    $this->problem("$path.$key", 'missing');
                    continue;
                }
                $this->compare($declared->genericTypes[1], $property, "$path.$key", $inside);
            }
            foreach (array_diff($keys, array_keys($schema['properties'])) as $key) {
                $this->problem("$path.$key", 'not in the API');
            }
            return;
        }
        $object = $declared instanceof ObjectShapeNode;
        if (!$declared instanceof ArrayShapeNode && !$object) {
            $this->problem($path, 'should be an array shape, array{...}');
            return;
        }
        $items = [];
        foreach ($declared->items as $item) {
            $items[self::key($item)] = $item;
        }
        $required = $schema['required'] ?? [];
        foreach ($schema['properties'] as $key => $property) {
            $at = "$path.$key";
            if (!isset($items[$key])) {
                $this->problem($at, 'missing');
                continue;
            }
            $item = $items[$key];
            unset($items[$key]);
            if ($object) {
                // A property the API may leave out reads as null.
                if (!in_array($key, $required, true) && $property !== []) {
                    if (!in_array('null', array_map(self::kind(...), $this->members($item->valueType)), true)) {
                        $this->problem($at, 'not nullable, the API may leave it out');
                    } else {
                        $property = ['anyOf' => [$property, ['type' => 'null']]];
                    }
                }
                $this->compare($item->valueType, $property, $at, $inside);
                continue;
            }
            // An open value: the schema cannot say whether it is sent.
            if ($property !== []) {
                if (in_array($key, $required, true) && $item->optional) {
                    $this->problem($at, 'optional, the API requires it');
                } elseif (!in_array($key, $required, true) && !$item->optional) {
                    $this->problem($at, 'required, the API makes it optional');
                }
            }
            $this->compare($item->valueType, $property, $at, $inside);
        }
        foreach (array_keys($items) as $key) {
            if (!in_array($key, $native, true)) {
                $this->problem("$path.$key", 'not in the API');
            }
        }
    }
}

/**
 * Resolves a docblock type into plain nodes the comparison reads: `@phpstan-type` aliases, model
 * classes as object shapes of their `@property-read` tags (parents and `@extends` templates
 * included), `Collection<Item>`, and constant wildcards (`self::STATUS_*`, `Category::*`) as
 * their string values. Names resolve like PHP's: through the file's `use` imports, else the
 * class's namespace.
 */
final class DeclaredTypes
{
    /** @var array<string, ObjectShapeNode> */
    private static array $classes = [];

    /** @param array<string, array{TypeNode, ReflectionClass}> $aliases name => [type, the class declaring it] */
    public function __construct(private array $aliases) {}

    /** @return array<string, array{TypeNode, ReflectionClass}> the `@phpstan-type` aliases of these classes */
    public static function aliasesOf(string ...$classes): array
    {
        $aliases = [];
        foreach ($classes as $class) {
            $reflection = new ReflectionClass($class);
            foreach (TypeContract::docblock($reflection->getDocComment())->getTypeAliasTagValues() as $alias) {
                $aliases[$alias->alias] = [$alias->type, $reflection];
            }
        }
        return $aliases;
    }

    /** @param array<string, TypeNode> $templates */
    public function resolve(TypeNode $type, ReflectionClass $scope, array $templates = []): TypeNode
    {
        return match (true) {
            $type instanceof UnionTypeNode => new UnionTypeNode(array_map(fn ($t) => $this->resolve($t, $scope, $templates), $type->types)),
            $type instanceof NullableTypeNode => new NullableTypeNode($this->resolve($type->type, $scope, $templates)),
            $type instanceof IntersectionTypeNode => new IntersectionTypeNode(array_map(fn ($t) => $this->resolve($t, $scope, $templates), $type->types)),
            $type instanceof ArrayTypeNode => new ArrayTypeNode($this->resolve($type->type, $scope, $templates)),
            $type instanceof ArrayShapeNode => ArrayShapeNode::createSealed(array_map(fn (ArrayShapeItemNode $item) => new ArrayShapeItemNode(
                $item->keyName, $item->optional, $this->resolve($item->valueType, $scope, $templates)), $type->items), $type->kind),
            $type instanceof ConstTypeNode && $type->constExpr instanceof ConstFetchNode => $this->constants($type->constExpr, $scope),
            $type instanceof GenericTypeNode => $this->generic($type, $scope, $templates),
            $type instanceof IdentifierTypeNode => $this->identifier($type, $scope, $templates),
            default => $type,
        };
    }

    private function generic(GenericTypeNode $type, ReflectionClass $scope, array $templates): TypeNode
    {
        $arguments = array_map(fn ($t) => $this->resolve($t, $scope, $templates), $type->genericTypes);
        $class = self::className($type->type->name, $scope);
        if ($class !== null && is_subclass_of($class, CalmLensObject::class)) {
            return $this->model(new ReflectionClass($class), $arguments);
        }
        return new GenericTypeNode($type->type, $arguments, $type->variances);
    }

    private function identifier(IdentifierTypeNode $type, ReflectionClass $scope, array $templates): TypeNode
    {
        if (isset($templates[$type->name])) {
            return $templates[$type->name];
        }
        if (isset($this->aliases[$type->name])) {
            [$alias, $declaring] = $this->aliases[$type->name];
            return $this->resolve($alias, $declaring);
        }
        $class = self::className($type->name, $scope);
        if ($class !== null && is_subclass_of($class, CalmLensObject::class)) {
            return $this->model(new ReflectionClass($class), []);
        }
        return $type;
    }

    /** A model class as an object shape of its properties, its templates bound to `$arguments`. */
    private function model(ReflectionClass $class, array $arguments): ObjectShapeNode
    {
        $key = $class->getName() . '<' . implode(',', array_map('strval', $arguments)) . '>';
        if (isset(self::$classes[$key])) {
            return self::$classes[$key];
        }
        $properties = [];
        $templates = [];
        $chain = [];
        for ($c = $class; $c !== false; $c = $c->getParentClass()) {
            array_unshift($chain, $c);
        }
        // Each class's templates: its own `@template` names bound to the arguments its child gave.
        $bound = $arguments;
        foreach (array_reverse($chain) as $c) {
            $doc = TypeContract::docblock($c->getDocComment());
            $names = array_map(fn ($tag) => $tag->name, $doc->getTemplateTagValues());
            $templates[$c->getName()] = array_combine(array_slice($names, 0, count($bound)), array_slice($bound, 0, count($names))) ?: [];
            $extends = $doc->getExtendsTagValues();
            $bound = $extends === [] ? [] : array_map(fn ($t) => $this->resolve($t, $c, $templates[$c->getName()]), $extends[0]->type->genericTypes);
        }
        foreach ($chain as $c) {
            $doc = TypeContract::docblock($c->getDocComment());
            foreach ([...$doc->getPropertyTagValues(), ...$doc->getPropertyReadTagValues()] as $tag) {
                $properties[ltrim($tag->propertyName, '$')] = $this->resolve($tag->type, $c, $templates[$c->getName()]);
            }
        }
        $items = [];
        foreach ($properties as $name => $type) {
            $items[] = new ObjectShapeItemNode(new IdentifierTypeNode($name), false, $type);
        }
        return self::$classes[$key] = new ObjectShapeNode($items);
    }

    /** `Class::PREFIX_*` as the union of the matching constants' values. */
    private function constants(ConstFetchNode $fetch, ReflectionClass $scope): TypeNode
    {
        $class = in_array($fetch->className, ['self', 'static'], true) ? $scope->getName() : self::className($fetch->className, $scope);
        $prefix = rtrim($fetch->name, '*');
        $values = [];
        foreach ((new ReflectionClass($class))->getReflectionConstants() as $constant) {
            if ($constant->isPublic() && ($fetch->name === $constant->getName() || (str_ends_with($fetch->name, '*') && str_starts_with($constant->getName(), $prefix)))) {
                $values[] = new ConstTypeNode(new ConstExprStringNode((string) $constant->getValue(), ConstExprStringNode::SINGLE_QUOTED));
            }
        }
        return count($values) === 1 ? $values[0] : new UnionTypeNode($values);
    }

    /** A class name as PHP resolves it in `$scope`'s file, or null for a builtin type. */
    private static function className(string $name, ReflectionClass $scope): ?string
    {
        if (str_starts_with($name, '\\')) {
            return class_exists($name) ? ltrim($name, '\\') : null;
        }
        [$first] = explode('\\', $name, 2);
        preg_match_all('/^use ([\\w\\\\]+)(?: as (\\w+))?;/m', file_get_contents($scope->getFileName()), $uses, PREG_SET_ORDER);
        foreach ($uses as $use) {
            $short = $use[2] ?? substr(strrchr('\\' . $use[1], '\\'), 1);
            if ($short === $first) {
                $resolved = $use[1] . substr($name, strlen($first));
                return class_exists($resolved) ? $resolved : null;
            }
        }
        $local = $scope->getNamespaceName() . '\\' . $name;
        return class_exists($local) ? $local : null;
    }
}
