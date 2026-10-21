<?php

namespace App\Providers;

use CalmLens\ServerClient;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(ServerClient::class, fn () => new ServerClient(
            apiKey: (string) config('calmlens.api_key'),
            projectId: (string) config('calmlens.project_id'),
        ));
    }
}
