<?php
/**
 * U.Venice Transport MU loader.
 */
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

$uvTransportPlugin = WPMU_PLUGIN_DIR . '/uv-transport-shortcodes/uv-transport-shortcodes.php';
if (is_readable($uvTransportPlugin)) {
    require_once $uvTransportPlugin;
}
