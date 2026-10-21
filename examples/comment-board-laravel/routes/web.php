<?php
use App\Http\Controllers\CommentController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('comments', ['comments' => session('comments', [])]));
Route::post('/comments', [CommentController::class, 'store']);
