'use strict';

/**
 * Home screen controller, the meat of the application. This controller
 * displays a list of categories with a row of tiles. Keyboard navigation
 * is used to select the tile, move tiles around, and activate tiles.
 */
angular.module('farnsworth')
    .controller('HomeController', function($location, $mdToast, $mdDialog, $timeout,
            $scope, hotkeys, SettingsService) {
        var slash = require('slash');               // Convert Windows paths to something we can use in `file:///` urls.
        var app = require('electron').remote.app;   // Needed to close the application.

        var self = this;
        var constants = {
            holdTime: 1500,                     // Time in MS we have to hold enter before we popup the edit dialog
            editingSaturation: 50,              // Saturation factor to apply to non-selected tiles when we're rearranging tiles.
            systemBackgroundColor: '#4B585C',   // Background color of the hardcoded "System" category tiles.
            systemTextColor: '#FFFFFF'          // Text color of the hardcoded "System" category tiles.
        };

        self.loading = true;                    // Used to track when to show the loading spinner.
        self.holding = null;                    // Set to a $timeout promise when we're holding enter on a tile.
        self.editing = false;                   // True when the edit popup is displayed, so we don't do weird things with tiles in the background.
        self.moving = false;                    // True when we're arranging a tile on the screen.
        self.categories = {};                   // Object containing all categories. Note: This is a reference to data that is read/written from the JSON file.
        self.categoryList = [];                 // Ordered list of categories.
        self.selectedCategory = null;           // The currently selected category.
        self.selectedCategoryIndex = 0;         // The index of the currently selected category, used when navigating and moving tiles.
        self.selectedTile = null;               // A reference to the currently selected tile.
        self.selectedTileIndex = 0;             // THe index of the currently selected tile.

        SettingsService.get().then(function(settings) {
            if(_.has(settings, 'categories')) {
                self.categories = settings.categories;

                self.init();
            } else {
                self.initEmpty();
            }

            self.loading = false;
        }).catch(function(error) {
            $mdToast.show(
              $mdToast.simple()
                .textContent(`Error loading application settings: ${error}`)
                    .hideDelay(3000));

            self.initEmpty();
            self.loading = false;
        });

        /**
         * Initialize an empty homescreen. Really just bind the "Enter" button
         * to trigger adding our first tile.
         */
        self.initEmpty = function() {
            hotkeys.bindTo($scope).add({
                combo: 'enter',
                description: 'Add your first tile.',
                callback: function() {
                    self.addTile();
                }
            });
        };

        /**
         * Initialize all of the things. This pre-processes categories and
         * creates the hardcoded System category.
         */
        self.init = function() {
            // Make sure we ignore transient categories when building the list
            // as we're going to add them later.
            self.categoryList = _.sortBy(_.filter(self.categories, function(category) {
                return !category.transient;
            }), 'order');
            self.selectedCategory = self.categoryList[self.selectedCategoryIndex];

            if(self.selectedCategory.tiles.length > self.selectedTileIndex) {
                self.selectedTile = self.selectedCategory.tiles[self.selectedTileIndex];
            }

            // Hardcoded System tiles for editing categories, adding new
            // tiles, exiting, etc.
            self.categories['System'] = {
                'name': 'System',
                'order': self.categoryList.length,
                'transient': true,
                'tiles': [{
                    'name': 'Add Tile',
                    'category': 'System',
                    'transient': true,
                    'backgroundColor': constants.systemBackgroundColor,
                    'textColor': constants.systemTextColor,
                    'command': 'about:farnsworth/add-tile'
                },{
                    'name': 'Edit Categories',
                    'category': 'System',
                    'transient': true,
                    'backgroundColor': constants.systemBackgroundColor,
                    'textColor': constants.systemTextColor,
                    'command': 'about:farnsworth/edit-categories'
                },{
                    'name': 'Settings',
                    'category': 'System',
                    'transient': true,
                    'backgroundColor': constants.systemBackgroundColor,
                    'textColor': constants.systemTextColor,
                    'command': 'about:farnsworth/settings'
                },{
                    'name': 'Exit',
                    'category': 'System',
                    'transient': true,
                    'backgroundColor': constants.systemBackgroundColor,
                    'textColor': constants.systemTextColor,
                    'command': 'about:farnsworth/exit'
                }]
            };

            self.categoryList.push(self.categories['System']);

            self.setupBindings();
        };

        /**
         * Setup all of our keybindings. All of these should not function
         * when we're in edit mode and also handle moving tiles around when
         * we're in arrange mode.
         */
        self.setupBindings = function() {
            // Move to the right.
            hotkeys.bindTo($scope).add({
                combo: 'right',
                description: 'Select the tile to the right of the currently selected tile.',
                callback: function() {
                    if(!self.editing) {
                        if(self.selectedTileIndex < self.selectedCategory.tiles.length - 1) {
                            if(self.moving) {
                                var temp = self.selectedCategory.tiles[self.selectedTileIndex+1];
                                self.selectedCategory.tiles[self.selectedTileIndex+1] = self.selectedTile;
                                self.selectedCategory.tiles[self.selectedTileIndex] = temp;
                            }

                            self.selectedTile = self.selectedCategory.tiles[++self.selectedTileIndex];
                        }
                    }
                }
            });

            // Move to the left.
            hotkeys.bindTo($scope).add({
                combo: 'left',
                description: 'Select the tile to the right of the currently selected tile.',
                callback: function() {
                    if(!self.editing) {
                        if(self.selectedTileIndex > 0) {
                            if(self.moving) {
                                var temp = self.selectedCategory.tiles[self.selectedTileIndex-1];
                                self.selectedCategory.tiles[self.selectedTileIndex-1] = self.selectedTile;
                                self.selectedCategory.tiles[self.selectedTileIndex] = temp;
                            }

                            self.selectedTile = self.selectedCategory.tiles[--self.selectedTileIndex];
                        }
                    }
                }
            });

            // Helper function to select the proper tile in the newly activated
            // category.
            var selectProperCategoryTile = function() {
                if(self.selectedTileIndex >= self.selectedCategory.tiles.length) {
                    // When moving, self.selectedTile doesn't change, so this is safe.
                    if(self.moving) {
                        self.selectedCategory.tiles.push(self.selectedTile);
                        self.selectedTileIndex = self.selectedCategory.tiles.length;
                    } else {
                        self.selectedTileIndex = self.selectedCategory.tiles.length - 1;
                    }
                } else if(self.moving) {
                    self.selectedCategory.tiles.splice(self.selectedTileIndex, 0, self.selectedTile);
                }

                self.selectedTile = self.selectedCategory.tiles[self.selectedTileIndex];
            };

            // Move down to the next category.
            hotkeys.bindTo($scope).add({
                combo: 'down',
                description: 'Select the tile below the currently selected tile.',
                callback: function() {
                    if(!self.editing) {
                        if(self.selectedCategoryIndex < self.categoryList.length - 1) {
                            if(self.moving) {
                                if(self.categoryList[self.selectedCategoryIndex + 1].transient) {
                                    return;
                                }

                                self.selectedCategory.tiles.splice(self.selectedTileIndex, 1);
                            }

                            self.selectedCategory = self.categoryList[++self.selectedCategoryIndex];

                            selectProperCategoryTile();
                        }
                    }
                }
            });

            // Move up to the previous category
            hotkeys.bindTo($scope).add({
                combo: 'up',
                description: 'Select the tile above the currently selected tile.',
                callback: function() {
                    if(!self.editing) {
                        if(self.selectedCategoryIndex > 0) {
                            if(self.moving) {
                                if(self.categoryList[self.selectedCategoryIndex - 1].transient) {
                                    return;
                                }

                                self.selectedCategory.tiles.splice(self.selectedTileIndex, 1);
                            }

                            self.selectedCategory = self.categoryList[--self.selectedCategoryIndex];

                            selectProperCategoryTile();
                        }
                    }
                }
            });

            // angular-hotkeys doesn't support multiple actions on one hotkey
            // so we need to do something a little interesting: rebind the hotkey
            // as it's pressed.
            var addEnterHotkey = function(action) {
                hotkeys.del('enter');

                hotkeys.bindTo($scope).add({
                    combo: 'enter',
                    action: action,
                    description: 'Activate the selected tile. Hold to edit instead.',
                    callback: function() {
                        if(self.editing) {
                            self.holding = null;
                        } else if(self.moving) {
                            // When we're moving, keyup will drop the tile, saving the
                            // location.
                            if(action === 'keyup') {
                                self.moving = false;
                                SettingsService.save().catch(function(error) {
                                    $mdToast.show(
                                      $mdToast.simple()
                                        .textContent(`Error saving tile: ${error}`)
                                            .hideDelay(3000));
                                });
                            }
                        } else {
                            // If we're not already holding enter, start.
                            if(!self.holding) {
                                addEnterHotkey('keyup');

                                self.holding = $timeout(function() {
                                    // Transient tiles can't be edited, always
                                    // activate them.
                                    if(!self.selectedTile.transient) {
                                        self.startEditing(self.selectedTile);
                                    } else {
                                        self.activate(self.selectedTile);
                                    }
                                }, constants.holdTime);
                            } else {
                                // If we're already holding it down, cancel
                                // the timer and activate the tile.
                                addEnterHotkey('keydown');

                                $timeout.cancel(self.holding);
                                self.holding = null;
                                self.activate(self.selectedTile);
                            }
                        }
                    }
                });
            }

            addEnterHotkey('keydown');
        }

        /**
         * Add a new tile.
         */
        self.addTile = function() {
            $location.path('/edit-tile');
        };

        /**
         * Edit the currently selected tile.
         */
        self.editTile = function() {
            $location.path(`/edit-tile/${self.selectedCategory.name}/${self.selectedTileIndex}`);
        };

        /**
         * Exit the app.
         */
        self.exit = function() {
            app.quit();
        };

        /**
         * Enter category editing mode. In this mode, we can only move up and down
         * categories, rearrange them, or rename them.
         */
        self.editCategoires = function() {

        };

        /**
         * Open the application settings.
         */
        self.settings = function() {
            $location.path('/settings');
        };

        /**
         * Get styling information for the current tile. This includes the
         * selected background as well as any filter when the tile
         * is not selected during move mode.
         * @param  {object} tile The tile for which to get the styles.
         */
        self.getTileStyle = function(tile) {
            var style;

            /*if(self.moving && self.selectedTile !== tile) {
                style = {
                    'background-color': tinycolor(tile.backgroundColor).desaturate(constants.editingSaturation).toString(),
                    'color': tinycolor(tile.textColor).desaturate(constants.editingSaturation).toString()
                };

                if(tile.image) {
                    style['background-image']: 'url("' + tile.image + '")',
                }
            } else {*/
                style = {
                    'background-color': tile.backgroundColor,
                    'color': tile.textColor
                };

                if(tile.image) {
                    style['background-image'] = 'url(file:///' + slash(tile.image) + ')';
                }
            //}

            if(self.moving && self.selectedTile !== tile) {
                style['filter'] = 'saturate(' + constants.editingSaturation + '%)';
            }

            console.log(style);

            return style;
        };

        /**
         * Activate the specified tile.
         * @param  {object} tile The tile.
         */
        self.activate = function(tile) {
            console.log('Launching tile: ', tile);

            // Any tile with a command that begins with 'about:farnsworth' is
            // an "internal" command, we handle those by simply taking the remaining
            // string, converting it to camelcase, and, assuming one exists, calling
            // the method with the converted name on this controller.
            //
            // TODO: Consider how safe this is. Since we're running in Electron and not
            // a traditional browser, it's probably ok and allows users to maybe add more
            // tiles for internal commands?
            if(tile.command.startsWith('about:farnsworth')) {
                var func = _.camelCase(tile.command.replace('about:farnsworth/', ''));

                if(_.has(self, func)) {
                    self[func]();
                }
            }
        };

        /**
         * Start tile editing mode for the given tile. Display a popup
         * with edit options:
         *
         * - arrange: Rearrange the tile on the screen.
         * - edit: Edit tile properties.
         * - delete: Delete the tile entirely.
         *
         * @param  {object} tile The tile to edit.
         */
        self.startEditing = function(tile) {
            self.editing = true;

            $mdDialog.show({
                controller: function(hotkeys, $scope, $mdDialog) {
                    //TODO: This has to match the order of the buttons in the
                    // HTML. Rework at some point to make this less terrible.
                    $scope.actions = [
                        'arrange', 'edit', 'cancel', 'delete'
                    ];
                    $scope.action = 0;

                    // Add left, right, and enter keybindings so we can do this
                    // with a keyboard/controller.
                    hotkeys.bindTo($scope).add({
                        combo: 'right',
                        description: 'Select the option right of the current option',
                        callback: function() {
                            if($scope.action < $scope.actions.length-1) {
                                $scope.action++;
                            }
                        }
                    });

                    hotkeys.bindTo($scope).add({
                        combo: 'left',
                        description: 'Select the option left of the curren options.',
                        callback: function() {
                            if($scope.action > 0) {
                                $scope.action--;
                            }
                        }
                    });

                    hotkeys.bindTo($scope).add({
                        combo: 'enter',
                        description: 'Activate the selected option.',
                        callback: function() {
                            if(!self.holding) {
                                $mdDialog.hide($scope.actions[$scope.action]);
                            }
                        }
                    })
                },
                templateUrl: 'views/dialogs/edit-tile-popup.html',
                parent: angular.element(document.body),
                clickOutsideToClose:true
            }).then(function(result) {
                switch(result) {
                    case 'arrange': self.moving = true; break;
                    case 'edit': self.editTile(); break;
                    case 'delete': self.deleteTile(); break;
                }
            }).finally(function() {
                self.editing = false;
                self.setupBindings();
            });
        };
    });
