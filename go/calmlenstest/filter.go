package calmlenstest

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// lookup returns the value at a dotted field path, such as "classification.moderation.status", or nil.
func lookup(asset calmlens.JSON, path string) any {
	var value any = asset
	for _, key := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = object[key]
	}
	return value
}

type filterNode interface {
	match(asset calmlens.JSON) bool
}
type anyOf []filterNode
type allOf []filterNode

// comparison is one field comparison. values holds each parsed value: a string, a float64 for a
// number field, or nil for `null` on a nullable field.
type comparison struct {
	field, op string
	values    []any
}

func (n anyOf) match(a calmlens.JSON) bool {
	for _, child := range n {
		if child.match(a) {
			return true
		}
	}
	return false
}
func (n allOf) match(a calmlens.JSON) bool {
	for _, child := range n {
		if !child.match(a) {
			return false
		}
	}
	return true
}

// compare orders a present asset value against a parsed filter value like the database:
// numbers numerically, text by code point. ok is false when they can't be compared.
func compare(value any, literal any) (order int, ok bool) {
	if n, isNumber := asNumber(value); isNumber {
		r, isFloat := literal.(float64)
		if !isFloat {
			return 0, false
		}
		switch {
		case n < r:
			return -1, true
		case n > r:
			return 1, true
		}
		return 0, true
	}
	text, isText := value.(string)
	r, isString := literal.(string)
	if !isText || !isString {
		return 0, false
	}
	return strings.Compare(text, r), true
}

func asNumber(value any) (float64, bool) {
	switch n := value.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// equal is SQL equality with a non-null value: a missing asset value never equals.
func equal(value, literal any) bool {
	order, ok := compare(value, literal)
	return ok && order == 0
}

// items are a list field's values, or nil when value is not a list.
func items(value any) ([]any, bool) {
	switch list := value.(type) {
	case []any:
		return list, true
	case []string:
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = item
		}
		return out, true
	}
	return nil, false
}

// match applies the comparison like the API's SQL: a comparison never matches a missing value,
// except `==null`, and `!=null` matches any present one.
func (c comparison) match(a calmlens.JSON) bool {
	value := lookup(a, c.field)
	if list, ok := items(value); ok && filterFields[c.field].kind == "list" {
		// A list field holds any of its values (=in=); other operators compare its items too.
		anyItem := func(test func(any) bool) bool {
			return slices.ContainsFunc(list, test)
		}
		switch c.op {
		case "==", "=in=":
			return anyItem(func(item any) bool {
				return slices.ContainsFunc(c.values, func(v any) bool { return v != nil && matchValue(item, v) })
			})
		case "!=", "=out=":
			return !anyItem(func(item any) bool {
				return slices.ContainsFunc(c.values, func(v any) bool { return v != nil && matchValue(item, v) })
			})
		}
		return false
	}
	literal := c.values[0]
	if literal == nil {
		switch c.op {
		case "==":
			return value == nil
		case "!=":
			return value != nil
		}
		// IN and comparisons with NULL never match; NOT IN with a NULL never matches either.
		if c.op != "=in=" {
			return false
		}
	}
	if value == nil {
		return false
	}
	switch c.op {
	case "==":
		return matchValue(value, literal)
	case "!=":
		if pattern, ok := literal.(string); ok && strings.Contains(pattern, "*") {
			text, isText := value.(string)
			return isText && !wildcard(text, pattern)
		}
		_, comparable := compare(value, literal)
		return comparable && !equal(value, literal)
	case "=in=":
		return slices.ContainsFunc(c.values, func(v any) bool { return v != nil && equal(value, v) })
	case "=out=":
		return !slices.Contains(c.values, nil) && !slices.ContainsFunc(c.values, func(v any) bool { return equal(value, v) })
	}
	order, ok := compare(value, literal)
	if !ok {
		return false
	}
	switch c.op {
	case ">":
		return order > 0
	case ">=":
		return order >= 0
	case "<":
		return order < 0
	case "<=":
		return order <= 0
	}
	return false
}

// matchValue is `==` with a non-null value: a text value with `*` is a wildcard pattern.
func matchValue(value, literal any) bool {
	if pattern, ok := literal.(string); ok && strings.Contains(pattern, "*") {
		text, isText := value.(string)
		return isText && wildcard(text, pattern)
	}
	return equal(value, literal)
}

// wildcard matches text against a pattern whose only wildcard is `*` (any run of characters),
// regardless of case; every other character, `%` and `_` included, matches itself.
func wildcard(text, pattern string) bool {
	parts := strings.Split(pattern, "*")
	for i := range parts {
		parts[i] = regexp.QuoteMeta(parts[i])
	}
	return regexp.MustCompile("(?is)^" + strings.Join(parts, ".*") + "$").MatchString(text)
}

type filterParser struct {
	input string
	pos   int
}

// parseFilter parses an RSQL filter like the API (@rsql/parser with zodbase/rsql): comparisons
// on filterFields with filterOperators, ";" or " and " for AND (binding tighter than ","
// or " or "), nested parentheses and whitespace between tokens. Each value is read by its
// field's kind. Anything else is an error, which the mock answers with validation/invalid-filter.
func parseFilter(input string) (filterNode, error) {
	p := &filterParser{input: input}
	p.space()
	if p.pos == len(p.input) {
		return nil, fmt.Errorf("empty filter")
	}
	node, err := p.or()
	if err == nil && p.pos != len(p.input) {
		err = fmt.Errorf("unexpected %q at %d", p.input[p.pos:], p.pos)
	}
	return node, err
}

// reserved are the characters an unquoted selector or value can't contain.
const reserved = "\"'();,=!~<> \n\t\r"

func (p *filterParser) space() {
	for p.pos < len(p.input) && strings.ContainsRune(" \n\t\r", rune(p.input[p.pos])) {
		p.pos++
	}
}

// peek skips whitespace and reports whether the input continues with prefix.
func (p *filterParser) peek(prefix string) bool {
	p.space()
	return strings.HasPrefix(p.input[p.pos:], prefix)
}

// logic consumes a canonical (";" or ",") or verbose ("and " or "or ") logic operator.
func (p *filterParser) logic(canonical, verbose string) bool {
	if p.peek(canonical) {
		p.pos++
		return true
	}
	if p.peek(verbose + " ") {
		p.pos += len(verbose)
		return true
	}
	return false
}

func (p *filterParser) or() (filterNode, error) {
	nodes := anyOf{}
	for {
		node, err := p.and()
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
		if !p.logic(",", "or") {
			return nodes, nil
		}
	}
}

func (p *filterParser) and() (filterNode, error) {
	nodes := allOf{}
	for {
		node, err := p.term()
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
		if !p.logic(";", "and") {
			return nodes, nil
		}
	}
}

// operator reads a comparison operator: a canonical one or any FIQL-style =name=.
func (p *filterParser) operator() string {
	p.space()
	for _, candidate := range []string{"==", "!=", "<=", ">=", "<", ">"} {
		if p.peek(candidate) {
			p.pos += len(candidate)
			return candidate
		}
	}
	if p.peek("=") {
		end := p.pos + 1
		for end < len(p.input) && p.input[end] >= 'a' && p.input[end] <= 'z' {
			end++
		}
		if end < len(p.input) && p.input[end] == '=' {
			op := p.input[p.pos : end+1]
			p.pos = end + 1
			return op
		}
	}
	return ""
}

func (p *filterParser) term() (filterNode, error) {
	if p.peek("(") {
		p.pos++
		node, err := p.or()
		if err != nil {
			return nil, err
		}
		if !p.peek(")") {
			return nil, fmt.Errorf("missing )")
		}
		p.pos++
		return node, nil
	}
	p.space()
	field, err := p.unquoted()
	if err != nil {
		return nil, err
	}
	info, known := filterFields[field]
	if !known {
		return nil, fmt.Errorf("unknown filter field %q", field)
	}
	op := p.operator()
	if op == "" {
		return nil, fmt.Errorf("missing operator after %q", field)
	}
	if !slices.Contains(filterOperators, op) {
		return nil, fmt.Errorf("unsupported operator %s", op)
	}
	raw := []string{}
	if p.peek("(") {
		p.pos++
		for {
			value, err := p.value()
			if err != nil {
				return nil, err
			}
			raw = append(raw, value)
			if p.peek(")") {
				p.pos++
				break
			}
			if !p.peek(",") {
				return nil, fmt.Errorf("missing ) in %s list", op)
			}
			p.pos++
		}
	} else {
		value, err := p.value()
		if err != nil {
			return nil, err
		}
		raw = append(raw, value)
	}
	if op != "=in=" && op != "=out=" && len(raw) != 1 {
		return nil, fmt.Errorf("%s takes one value", op)
	}
	values := make([]any, len(raw))
	for i, value := range raw {
		if values[i], err = info.read(value); err != nil {
			return nil, err
		}
	}
	return comparison{field, op, values}, nil
}

// read parses a value like zodbase/rsql: `null` is a missing value on a nullable field, a number
// field's value must be a finite number, and any other value is text.
func (f filterField) read(value string) (any, error) {
	if value == "null" && f.nullable {
		return nil, nil
	}
	if f.kind != "number" {
		return value, nil
	}
	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsInf(number, 0) || math.IsNaN(number) || strings.TrimSpace(value) == "" {
		return nil, fmt.Errorf("invalid numeric value %q", value)
	}
	return number, nil
}

func (p *filterParser) unquoted() (string, error) {
	start := p.pos
	for p.pos < len(p.input) && !strings.ContainsRune(reserved, rune(p.input[p.pos])) {
		p.pos++
	}
	if p.pos == start {
		return "", fmt.Errorf("unexpected input at %d", start)
	}
	return p.input[start:p.pos], nil
}

func (p *filterParser) value() (string, error) {
	p.space()
	if p.pos < len(p.input) && (p.input[p.pos] == '"' || p.input[p.pos] == '\'') {
		quote := p.input[p.pos]
		p.pos++
		var out strings.Builder
		for p.pos < len(p.input) {
			b := p.input[p.pos]
			p.pos++
			if b == '\\' && p.pos < len(p.input) {
				out.WriteByte(p.input[p.pos])
				p.pos++
				continue
			}
			if b == quote {
				return out.String(), nil
			}
			out.WriteByte(b)
		}
		return "", fmt.Errorf("unterminated string")
	}
	return p.unquoted()
}
