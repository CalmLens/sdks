package calmlenstest

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// filterFields are the asset fields the mock accepts in RSQL filters and ordering; nested
// fields are named by path.
var filterFields = map[string]bool{
	"id": true, "name": true, "type": true, "visibility": true, "parentId": true,
	"folderId": true, "externalId": true, "externalUrl": true, "createdAt": true, "updatedAt": true,
	"tags": true, "description": true, "userId": true,
	"classification.status": true, "classification.updatedAt": true,
	"classification.moderation.status": true,
	"moderation.completedAt":           true,
	"content.status":                   true, "content.removalReason": true, "content.format": true,
	"content.extension": true, "content.sizeInBytes": true,
}

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
type comparison struct {
	field, op string
	values    []string
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

// compareValues orders two values numerically when both are numbers, otherwise as text.
func compareValues(left any, right string) int {
	if n, ok := asNumber(left); ok {
		if r, err := strconv.ParseFloat(right, 64); err == nil {
			switch {
			case n < r:
				return -1
			case n > r:
				return 1
			}
			return 0
		}
	}
	return strings.Compare(fmt.Sprint(left), right)
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

func equal(value any, literal string) bool {
	if value == nil {
		return literal == "null"
	}
	if b, ok := value.(bool); ok {
		return strconv.FormatBool(b) == literal
	}
	return compareValues(value, literal) == 0
}

func (c comparison) match(a calmlens.JSON) bool {
	value := lookup(a, c.field)
	values := []any{value}
	if list, ok := value.([]any); ok {
		values = list
	} else if list, ok := value.([]string); ok {
		values = values[:0]
		for _, item := range list {
			values = append(values, item)
		}
	}
	anyEqual := func() bool {
		for _, v := range values {
			for _, literal := range c.values {
				if equal(v, literal) {
					return true
				}
			}
		}
		return false
	}
	switch c.op {
	case "==":
		if strings.Contains(c.values[0], "*") {
			return like(value, c.values[0])
		}
		return anyEqual()
	case "=in=":
		return anyEqual()
	case "!=":
		if strings.Contains(c.values[0], "*") {
			return !like(value, c.values[0])
		}
		return !anyEqual()
	case "=out=":
		return !anyEqual()
	case "=like=":
		return like(value, c.values[0])
	}
	if value == nil {
		return false
	}
	order := compareValues(value, c.values[0])
	switch c.op {
	case ">", "=gt=":
		return order > 0
	case ">=", "=ge=":
		return order >= 0
	case "<", "=lt=":
		return order < 0
	case "<=", "=le=":
		return order <= 0
	}
	return false
}

func like(value any, pattern string) bool {
	text, ok := value.(string)
	if !ok {
		return false
	}
	parts := strings.Split(pattern, "*")
	for i := range parts {
		parts[i] = regexp.QuoteMeta(parts[i])
	}
	return regexp.MustCompile("(?i)^" + strings.Join(parts, ".*") + "$").MatchString(text)
}

type filterParser struct {
	input string
	pos   int
}

// parseFilter parses the RSQL subset the API documents: ==, !=, >, >=, <, <=, =in=, =out=,
// =like= (and =gt=-style aliases), ";" for AND (binding tighter than ","), "," for OR and
// nested parentheses.
func parseFilter(input string) (filterNode, error) {
	p := &filterParser{input: input}
	node, err := p.or()
	if err == nil && p.pos != len(p.input) {
		err = fmt.Errorf("unexpected %q at %d", p.input[p.pos:], p.pos)
	}
	return node, err
}

func (p *filterParser) peek(prefix string) bool { return strings.HasPrefix(p.input[p.pos:], prefix) }

func (p *filterParser) or() (filterNode, error) {
	nodes := anyOf{}
	for {
		node, err := p.and()
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
		if !p.peek(",") {
			return nodes, nil
		}
		p.pos++
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
		if !p.peek(";") {
			return nodes, nil
		}
		p.pos++
	}
}

var operators = []string{"=in=", "=out=", "=like=", "=gt=", "=ge=", "=lt=", "=le=", "==", "!=", ">=", "<=", ">", "<"}

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
	start := p.pos
	for p.pos < len(p.input) && (isWord(p.input[p.pos])) {
		p.pos++
	}
	field := p.input[start:p.pos]
	if !filterFields[field] {
		return nil, fmt.Errorf("unknown filter field %q", field)
	}
	op := ""
	for _, candidate := range operators {
		if p.peek(candidate) {
			op = candidate
			break
		}
	}
	if op == "" {
		return nil, fmt.Errorf("missing operator after %q", field)
	}
	p.pos += len(op)
	if op == "=in=" || op == "=out=" {
		if !p.peek("(") {
			return nil, fmt.Errorf("%s needs a list", op)
		}
		p.pos++
		values := []string{}
		for {
			value, err := p.value()
			if err != nil {
				return nil, err
			}
			values = append(values, value)
			if p.peek(")") {
				p.pos++
				return comparison{field, op, values}, nil
			}
			if !p.peek(",") {
				return nil, fmt.Errorf("missing ) in %s list", op)
			}
			p.pos++
		}
	}
	value, err := p.value()
	if err != nil {
		return nil, err
	}
	return comparison{field, op, []string{value}}, nil
}

func isWord(b byte) bool {
	return b == '_' || b == '.' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9'
}

func (p *filterParser) value() (string, error) {
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
	start := p.pos
	for p.pos < len(p.input) && !strings.ContainsRune(";,()", rune(p.input[p.pos])) {
		p.pos++
	}
	if p.pos == start {
		return "", fmt.Errorf("missing value at %d", start)
	}
	return p.input[start:p.pos], nil
}
