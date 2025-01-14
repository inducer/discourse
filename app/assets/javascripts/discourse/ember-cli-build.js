"use strict";

const EmberApp = require("ember-cli/lib/broccoli/ember-app");
const { resolve, join } = require("path");
const mergeTrees = require("broccoli-merge-trees");
const concat = require("broccoli-concat");
const { createI18nTree } = require("./lib/translation-plugin");
const { parsePluginClientSettings } = require("./lib/site-settings-plugin");
const discourseScss = require("./lib/discourse-scss");
const generateScriptsTree = require("./lib/scripts");
const funnel = require("broccoli-funnel");
const DeprecationSilencer = require("deprecation-silencer");
const generateWorkboxTree = require("./lib/workbox-tree-builder");

process.env.BROCCOLI_ENABLED_MEMOIZE = true;

module.exports = function (defaults) {
  const discourseRoot = resolve("../../../..");
  const vendorJs = discourseRoot + "/vendor/assets/javascripts/";

  // Silence deprecations which we are aware of - see `lib/deprecation-silencer.js`
  DeprecationSilencer.silence(console, "warn");
  DeprecationSilencer.silence(defaults.project.ui, "writeWarnLine");

  const isProduction = EmberApp.env().includes("production");
  const isTest = EmberApp.env().includes("test");

  const app = new EmberApp(defaults, {
    autoRun: false,
    "ember-qunit": {
      insertContentForTestBody: false,
    },
    sourcemaps: {
      // There seems to be a bug with broccoli-concat when sourcemaps are disabled
      // that causes the `app.import` statements below to fail in production mode.
      // This forces the use of `fast-sourcemap-concat` which works in production.
      enabled: true,
    },
    autoImport: {
      forbidEval: true,
      insertScriptsAt: "ember-auto-import-scripts",
      webpack: {
        // Workarounds for https://github.com/ef4/ember-auto-import/issues/519 and https://github.com/ef4/ember-auto-import/issues/478
        devtool: isProduction ? false : "source-map", // Sourcemaps contain reference to the ephemeral broccoli cache dir, which changes on every deploy
        optimization: {
          moduleIds: "size", // Consistent module references https://github.com/ef4/ember-auto-import/issues/478#issuecomment-1000526638
        },
        resolve: {
          fallback: {
            // Sinon needs a `util` polyfill
            util: require.resolve("util/"),
            // Also for sinon
            timers: false,
          },
        },
        module: {
          rules: [
            // Sinon/`util` polyfill accesses the `process` global,
            // so we need to provide a mock
            {
              test: require.resolve("util/"),
              use: [
                {
                  loader: "imports-loader",
                  options: {
                    additionalCode: "var process = { env: {} };",
                  },
                },
              ],
            },
          ],
        },
      },
    },
    fingerprint: {
      // Handled by Rails asset pipeline
      enabled: false,
    },
    SRI: {
      // We don't use SRI in Rails. Disable here to match:
      enabled: false,
    },

    "ember-cli-terser": {
      enabled: isProduction,
      exclude: [
        "**/test-*.js",
        "**/core-tests*.js",
        "**/highlightjs/*",
        "**/javascripts/*",
      ],
    },

    "ember-cli-babel": {
      throwUnlessParallelizable: true,
    },

    babel: {
      plugins: [require.resolve("deprecation-silencer")],
    },

    // We need to build tests in prod for theme tests
    tests: true,

    vendorFiles: {
      // Freedom patch - includes bug fix and async stack support
      // https://github.com/discourse/backburner.js/commits/discourse-patches
      backburner:
        "node_modules/@discourse/backburner.js/dist/named-amd/backburner.js",
    },
  });

  // Patching a private method is not great, but there's no other way for us to tell
  // Ember CLI that we want the tests alone in a package without helpers/fixtures, since
  // we re-use those in the theme tests.
  app._defaultPackager.packageApplicationTests = function (tree) {
    let appTestTrees = []
      .concat(
        this.packageEmberCliInternalFiles(),
        this.packageTestApplicationConfig(),
        tree
      )
      .filter(Boolean);

    appTestTrees = mergeTrees(appTestTrees, {
      overwrite: true,
      annotation: "TreeMerger (appTestTrees)",
    });

    const tests = concat(appTestTrees, {
      inputFiles: ["**/tests/**/*-test.js"],
      headerFiles: ["vendor/ember-cli/tests-prefix.js"],
      footerFiles: ["vendor/ember-cli/app-config.js"],
      outputFile: "/assets/core-tests.js",
      annotation: "Concat: Core Tests",
      sourceMapConfig: false,
    });

    const testHelpers = concat(appTestTrees, {
      inputFiles: [
        "**/tests/loader-shims.js",
        "**/tests/test-boot-ember-cli.js",
        "**/tests/helpers/**/*.js",
        "**/tests/fixtures/**/*.js",
        "**/tests/setup-tests.js",
      ],
      outputFile: "/assets/test-helpers.js",
      annotation: "Concat: Test Helpers",
      sourceMapConfig: false,
    });

    if (isTest) {
      return mergeTrees([
        tests,
        testHelpers,
        discourseScss(`${discourseRoot}/app/assets/stylesheets`, "qunit.scss"),
        discourseScss(
          `${discourseRoot}/app/assets/stylesheets`,
          "qunit-custom.scss"
        ),
      ]);
    } else {
      return mergeTrees([tests, testHelpers]);
    }
  };

  // WARNING: We should only import scripts here if they are not in NPM.
  // For example: our very specific version of bootstrap-modal.
  app.import(vendorJs + "bootbox.js");
  app.import("node_modules/bootstrap/js/modal.js");
  app.import(vendorJs + "caret_position.js");
  app.import("node_modules/ember-source/dist/ember-template-compiler.js", {
    type: "test",
  });
  app.import(discourseRoot + "/app/assets/javascripts/polyfills.js");

  app.import(
    discourseRoot +
      "/app/assets/javascripts/discourse/public/assets/scripts/module-shims.js"
  );

  // See: https://github.com/embroider-build/embroider/issues/1574
  // Specifically, markdownItBundleTree is triggering the MacrosConfig error
  finalizeEmbroiderMacrosConfigs(app, resolve("."), app.project);

  const discoursePluginsTree = app.project
    .findAddonByName("discourse-plugins")
    .generatePluginsTree();

  const adminTree = app.project.findAddonByName("admin").treeForAddonBundle();

  const wizardTree = app.project.findAddonByName("wizard").treeForAddonBundle();

  const markdownItBundleTree = app.project
    .findAddonByName("pretty-text")
    .treeForMarkdownItBundle();

  return app.toTree([
    createI18nTree(discourseRoot, vendorJs),
    parsePluginClientSettings(discourseRoot, vendorJs, app),
    funnel(`${discourseRoot}/public/javascripts`, { destDir: "javascripts" }),
    funnel(`${vendorJs}/highlightjs`, {
      files: ["highlight-test-bundle.min.js"],
      destDir: "assets/highlightjs",
    }),
    generateWorkboxTree(),
    concat(adminTree, {
      inputFiles: ["**/*.js"],
      outputFile: `assets/admin.js`,
    }),
    concat(wizardTree, {
      inputFiles: ["**/*.js"],
      outputFile: `assets/wizard.js`,
    }),
    concat(markdownItBundleTree, {
      inputFiles: ["**/*.js"],
      outputFile: `assets/markdown-it-bundle.js`,
    }),
    generateScriptsTree(app),
    discoursePluginsTree,
  ]);
};

// See: https://github.com/embroider-build/embroider/issues/1574
function finalizeEmbroiderMacrosConfigs(appInstance, appRoot, parent) {
  parent.initializeAddons?.();

  for (let addon of parent.addons) {
    if (addon.name === "@embroider/macros") {
      const MacrosConfig = require(join(
        addon.packageRoot,
        "src",
        "macros-config"
      )).default;
      MacrosConfig.for(appInstance, appRoot).finalize();
    } else {
      finalizeEmbroiderMacrosConfigs(appInstance, appRoot, addon);
    }
  }
}
