<?php

use App\Http\Controllers\PostController;
use App\Http\Middleware\EnsureTenant;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', EnsureTenant::class])
    ->prefix('admin')
    ->group(function (): void {
        Route::resource('posts', PostController::class);
    });
