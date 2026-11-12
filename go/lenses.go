package calmlens

import "context"

// LensesService manages the project's lenses: named image transforms the CDN applies at
// "/@<identifier>". The CDN serves files made with each lens's current definition. EnsureLenses
// creates or changes lenses by identifier, for applications that declare theirs in code.
type LensesService struct{ c *ServerClient }

// List returns one page of the project's lenses, newest first unless options.Sort says
// otherwise. The built-in lenses are always available and aren't listed. Use ListAll to iterate
// over every page.
func (s *LensesService) List(ctx context.Context, options ListLensesOptions) (*LensPage, error) {
	ctx, paramsErr := withParams(ctx, options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	var result LensPage
	if err = s.c.request(ctx, "GET", s.c.project("lenses"), params, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Create creates a lens. Its identifier must be new to the project; otherwise it fails with
// CodeLensIdentifierTaken.
func (s *LensesService) Create(ctx context.Context, options CreateLensOptions) (*Lens, error) {
	ctx, paramsErr := withParams(ctx, options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	var result Lens
	if err := s.c.request(ctx, "POST", s.c.project("lenses"), nil, options, &result); err != nil {
		return nil, err
	}
	s.forget(func(cached Lens) bool { return cached.Identifier == result.Identifier })
	return &result, nil
}

// Retrieve returns one of the project's lenses by ID.
func (s *LensesService) Retrieve(ctx context.Context, options LensIDOptions) (*Lens, error) {
	ctx, paramsErr := withParams(ctx, options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.lensRequest(ctx, "GET", options.LensID, nil)
}

// Update changes a lens's name, description, type, transform or whether the CDN serves it. The
// CDN serves the new transform from then on.
func (s *LensesService) Update(ctx context.Context, options UpdateLensOptions) (*Lens, error) {
	ctx, paramsErr := withParams(ctx, options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	lens, err := s.lensRequest(ctx, "PATCH", options.LensID, options)
	if err != nil {
		return nil, err
	}
	s.forget(func(cached Lens) bool { return cached.ID == lens.ID })
	return lens, nil
}

// Delete deletes a lens. URLs that select it stop being served; files the CDN already
// delivered may stay in caches until they expire.
func (s *LensesService) Delete(ctx context.Context, options LensIDOptions) error {
	ctx, paramsErr := withParams(ctx, options.Params)
	if paramsErr != nil {
		return paramsErr
	}
	path, err := resourcePath("lenses", options.LensID, "")
	if err != nil {
		return err
	}
	if err = s.c.request(ctx, "DELETE", path, nil, nil, nil); err != nil {
		return err
	}
	s.forget(func(cached Lens) bool { return cached.ID == options.LensID })
	return nil
}

func (s *LensesService) lensRequest(ctx context.Context, method, id string, body any) (*Lens, error) {
	path, err := resourcePath("lenses", id, "")
	if err != nil {
		return nil, err
	}
	var result Lens
	if err = s.c.request(ctx, method, path, nil, body, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// forget drops the definitions EnsureLens cached for a lens changed here, so the next ensure
// sends its definition again.
func (s *LensesService) forget(matches func(Lens) bool) {
	cache := s.c.lenses
	cache.lock <- struct{}{}
	defer func() { <-cache.lock }()
	for key, cached := range cache.lenses {
		if matches(cached) {
			delete(cache.lenses, key)
		}
	}
}
