<?php
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/calmlens', WebhookController::class);
