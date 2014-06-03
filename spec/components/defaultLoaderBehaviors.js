describe('Components: Default loader', function() {

    var testComponentName = 'test-component';

    afterEach(function() {
        ko.components.unregister(testComponentName);
    });

    it('Allows registration of arbitrary component config objects, reports that they are registered, and allows unregistration', function() {
        ko.components.register(testComponentName, {});

        expect(ko.components.isRegistered(testComponentName)).toBe(true);
        expect(ko.components.isRegistered('other-component')).toBe(false);

        ko.components.unregister(testComponentName, {});
        ko.components.unregister('nonexistent-component', {}); // No error - it's just a no-op, since it's harmless

        expect(ko.components.isRegistered(testComponentName)).toBe(false);
    });

    it('Throws if you try to register a component that is already registered', function() {
        ko.components.register(testComponentName, {});

        expect(function() {
            ko.components.register(testComponentName, {});
        }).toThrow();
    });

    it('Throws if you try to register a falsey value', function() {
        expect(function() {
            ko.components.register(testComponentName, null);
        }).toThrow();

        expect(function() {
            ko.components.register(testComponentName, undefined);
        }).toThrow();
    });

    it('getConfig supplies config objects from the in-memory registry', function() {
        var expectedConfig = {},
            didComplete = false;

        ko.components.register(testComponentName, expectedConfig);
        ko.components.defaultLoader.getConfig(testComponentName, function(actualConfig) {
            expect(actualConfig).toBe(expectedConfig);
            didComplete = true;
        });

        waitsFor(function() { return didComplete; }, 100);
    });

    it('getConfig supplies null for unknown components', function() {
        var didComplete = false;

        ko.components.defaultLoader.getConfig(testComponentName, function(actualConfig) {
            expect(actualConfig).toBe(null);
            didComplete = true;
        });

        waitsFor(function() { return didComplete; }, 100);
    });

    it('Can load a template and viewmodel simultaneously', function() {
        // Set up a configuration in which both template and viewmodel have to be loaded asynchronously
        var templateProviderCallback,
            viewModelProviderCallback,
            createViewModelFunction = function() { },
            domNodeArray = [],
            didResolveDefinition = false,
            config = {
                template: { require: 'path/templateModule' },
                viewModel: { require: 'path/viewModelModule' }
            };

        this.restoreAfter(window, 'require');
        window.require = function(modules, callback) {
            expect(modules.length).toBe(1);
            switch (modules[0]) {
                case 'path/templateModule':
                    templateProviderCallback = callback;
                    break;
                case 'path/viewModelModule':
                    viewModelProviderCallback = callback;
                    break;
                default:
                    throw new Error('Unexpected requirement for module ' + modules[0]);
            }
        };

        // Start the loading process
        testConfigObject(config, function(definition) {
            didResolveDefinition = true;
            expect(definition.template).toBe(domNodeArray);
            expect(definition.createViewModel).toBe(createViewModelFunction);
        });

        // Both modules start loading before either completes
        expect(typeof templateProviderCallback).toBe('function');
        expect(typeof viewModelProviderCallback).toBe('function');

        // When the first one completes, nothing else happens
        viewModelProviderCallback({ createViewModel: createViewModelFunction });
        expect(didResolveDefinition).toBe(false);

        // When the other one completes, the definition is supplied
        templateProviderCallback(domNodeArray);
        expect(didResolveDefinition).toBe(true);
    });

    it('Can resolve templates and viewmodels recursively', function() {
        // Set up a component which is a module in which:
        //  - template is a further module which supplies markup
        //  - viewModel is a further module which supplies a constructor
        mockAmdEnvironment(this, {
            componentmodule: {
                template: { require: 'templatemodule' },
                viewModel: { require: 'viewmodelmodule' }
            },
            templatemodule: '<div>Hello world</div>',
            viewmodelmodule: {
                viewModel: function(params) {
                    this.receivedValue = params.suppliedValue;
                }
            }
        })

        // Resolve it all
        testConfigObject({ require: 'componentmodule' }, function(definition) {
            expect(definition.template.length).toBe(1);
            expect(definition.template[0]).toContainText('Hello world');

            var viewModel = definition.createViewModel({ suppliedValue: 12.3 }, null /* componentInfo */);
            expect(viewModel.receivedValue).toBe(12.3);
        });
    });

    it('Can be asked to resolve a template directly', function() {
        var templateConfig = '<span>Markup string</span><div>More</div>',
            didLoad = false;
        ko.components.defaultLoader.loadTemplate('any-component', templateConfig, function(result) {
            expect(result.length).toBe(2);
            expect(result[0].tagName).toBe('SPAN');
            expect(result[1].tagName).toBe('DIV');
            expect(result[0].innerHTML).toBe('Markup string');
            expect(result[1].innerHTML).toBe('More');
            didLoad = true;
        });
        expect(didLoad).toBe(true);
    });

    it('Can be asked to resolve a viewmodel directly', function() {
        var testConstructor = function(params) { this.suppliedParams = params; },
            didLoad = false;
        ko.components.defaultLoader.loadViewModel('any-component', testConstructor, function(result) {
            // Result is of the form: function(params, componentInfo) { ... }
            var testParams = {},
                resultInstance = result(testParams, null /* componentInfo */);
            expect(resultInstance instanceof testConstructor).toBe(true);
            expect(resultInstance.suppliedParams).toBe(testParams);
            didLoad = true;
        });
        expect(didLoad).toBe(true);
    });

    it('Will load templates via \'loadTemplate\' on any other registered loader that precedes it', function() {
        var testLoader = {
            loadTemplate: function(componentName, templateConfig, callback) {
                expect(componentName).toBe(testComponentName);
                expect(templateConfig.customThing).toBe(123);
                callback(ko.utils.parseHtmlFragment('<div>Hello world</div>'));
            },
            loadViewModel: function(componentName, viewModelConfig, callback) {
                // Fall through to other loaders
                callback(null);
            }
        };

        this.restoreAfter(ko.components, 'loaders');
        ko.components.loaders = [testLoader, ko.components.defaultLoader];

        var config = {
            template: { customThing: 123 }, // The custom loader understands this format and will handle it
            viewModel: { instance: {} }     // The default loader understands this format and will handle it
        };
        testConfigObject(config, function(definition) {
            expect(definition.template.length).toBe(1);
            expect(definition.template[0]).toContainText('Hello world');

            var viewModel = definition.createViewModel(null, null);
            expect(viewModel).toBe(config.viewModel.instance);
        });
    });

    it('Will load viewmodels via \'loadViewModel\' on any other registered loader that precedes it', function() {
        var testParams = {}, testComponentInfo = {}, testViewModel = {};
        var testLoader = {
            loadTemplate: function(componentName, templateConfig, callback) {
                // Fall through to other loaders
                callback(null);
            },
            loadViewModel: function(componentName, viewModelConfig, callback) {
                expect(componentName).toBe(testComponentName);
                expect(viewModelConfig.customThing).toBe(456);
                callback(function(params, componentInfo) {
                    expect(params).toBe(testParams);
                    expect(componentInfo).toBe(testComponentInfo);
                    return testViewModel;
                });
            }
        };

        this.restoreAfter(ko.components, 'loaders');
        ko.components.loaders = [testLoader, ko.components.defaultLoader];

        var config = {
            template: '<div>Hello world</div>', // The default loader understands this format and will handle it
            viewModel: { customThing: 456 }     // The custom loader understands this format and will handle it
        };
        testConfigObject(config, function(definition) {
            expect(definition.template.length).toBe(1);
            expect(definition.template[0]).toContainText('Hello world');

            var viewModel = definition.createViewModel(testParams, testComponentInfo);
            expect(viewModel).toBe(testViewModel);
        });
    });

    describe('Configuration formats', function() {
        describe('Templates are normalised to arrays of DOM nodes', function() {

            it('Can be configured as a DOM node array', function() {
                var domNodeArray = [ document.createElement('div'), document.createElement('p') ];
                testConfigObject({ template: domNodeArray }, function(definition) {
                    expect(definition.template).toBe(domNodeArray);
                });
            });

            it('Can be configured as a document fragment', function() {
                var docFrag = document.createDocumentFragment(),
                    elem = document.createElement('div');
                docFrag.appendChild(elem);
                testConfigObject({ template: docFrag }, function(definition) {
                    expect(definition.template).toEqual([elem]);
                });
            });

            it('Can be configured as a string of markup', function() {
                testConfigObject({ template: '<p>Some text</p><div>More stuff</div>' }, function(definition) {
                    // Converts to standard array-of-DOM-nodes format
                    expect(definition.template.length).toBe(2);
                    expect(definition.template[0].tagName).toBe('P');
                    expect(definition.template[0]).toContainText('Some text');
                    expect(definition.template[1].tagName).toBe('DIV');
                    expect(definition.template[1]).toContainText('More stuff');
                });
            });

            it('Can be configured as an element ID', function() {
                var testElem = document.createElement('div');
                testElem.id = 'some-template-element';
                testElem.innerHTML = '<p>Some text</p><div>More stuff</div>';
                document.body.appendChild(testElem);

                testConfigObject({ template: { element: 'some-template-element' } }, function(definition) {
                    // Converts to standard array-of-DOM-nodes format
                    expect(definition.template.length).toBe(2);
                    expect(definition.template[0].tagName).toBe('P');
                    expect(definition.template[0]).toContainText('Some text');
                    expect(definition.template[1].tagName).toBe('DIV');
                    expect(definition.template[1]).toContainText('More stuff');
                    testElem.parentNode.removeChild(testElem);

                    // Doesn't destroy the input element
                    expect(testElem.childNodes.length).toBe(2);
                });
            });

            it('Can be configured as a container element', function() {
                var testElem = document.createElement('div');
                testElem.innerHTML = '<p>Some text</p><div>More stuff</div>';

                testConfigObject({ template: { element: testElem } }, function(definition) {
                    // Converts to standard array-of-DOM-nodes format
                    expect(definition.template.length).toBe(2);
                    expect(definition.template[0].tagName).toBe('P');
                    expect(definition.template[0]).toContainText('Some text');
                    expect(definition.template[1].tagName).toBe('DIV');
                    expect(definition.template[1]).toContainText('More stuff');

                    // Doesn't destroy the input element
                    expect(testElem.childNodes.length).toBe(2);
                });
            });

            it('Can be configured as an AMD module whose value is a DOM node array', function() {
                var domNodeArray = [ document.createElement('div'), document.createElement('p') ];
                mockAmdEnvironment(this, { 'some/module/path': domNodeArray });

                testConfigObject({ template: { require: 'some/module/path' } }, function(definition) {
                    expect(definition.template).toBe(domNodeArray);
                });
            });

            it('Can be configured as an AMD module whose value is a document fragment', function() {
                var docFrag = document.createDocumentFragment(),
                    elem = document.createElement('div');
                docFrag.appendChild(elem);
                mockAmdEnvironment(this, { 'some/module/path': docFrag });

                testConfigObject({ template: { require: 'some/module/path' } }, function(definition) {
                    expect(definition.template).toEqual([elem]);
                });
            });

            it('Can be configured as an AMD module whose value is markup', function() {
                mockAmdEnvironment(this, { 'some/module/path': '<div>Hello world</div><p>The end</p>' });

                testConfigObject({ template: { require: 'some/module/path' } }, function(definition) {
                    expect(definition.template.length).toBe(2);
                    expect(definition.template[0].tagName).toBe('DIV');
                    expect(definition.template[0]).toContainText('Hello world');
                    expect(definition.template[1].tagName).toBe('P');
                    expect(definition.template[1]).toContainText('The end');
                });
            });

            // In the future we might also support arbitrary objects acting as component templates,
            // possibly with a config syntax like "template: { custom: arbitraryObject }", which
            // would be passed through (without normalisation) to a custom template engine.
        });

        describe('Viewmodels', function() {
            it('Can be configured as a createViewModel function', function() {
                var createViewModel = function() { };

                testConfigObject({ viewModel: { createViewModel: createViewModel } }, function(definition) {
                    expect(definition.createViewModel).toBe(createViewModel);
                });
            });

            it('Can be configured as a constructor function', function() {
                var myConstructor = function(params) { this.receivedValue = params.suppliedValue; };

                testConfigObject({ viewModel: myConstructor }, function(definition) {
                    var viewModel = definition.createViewModel({ suppliedValue: 123 }, null /* componentInfo */);
                    expect(viewModel.receivedValue).toBe(123);
                });
            });

            it('Can be configured as an object instance', function() {
                var myInstance = {};

                testConfigObject({ viewModel: { instance: myInstance } }, function(definition) {
                    var viewModel = definition.createViewModel(null /* params */, null /* componentInfo */);
                    expect(viewModel).toBe(myInstance);
                });
            });

            it('Can be configured as an AMD module that supplies a createViewModel factory', function() {
                var createViewModel = function() { };
                mockAmdEnvironment(this, { 'some/module/path': { createViewModel: createViewModel } });

                testConfigObject({ viewModel: { require: 'some/module/path' } }, function(definition) {
                    expect(definition.createViewModel).toBe(createViewModel);
                });
            });

            it('Can be configured as an AMD module that is a constructor function', function() {
                var myConstructor = function(params) { this.receivedValue = params.suppliedValue; };
                mockAmdEnvironment(this, { 'some/module/path': myConstructor });

                testConfigObject({ viewModel: { require: 'some/module/path' } }, function(definition) {
                    var viewModel = definition.createViewModel({ suppliedValue: 234 }, null /* componentInfo */);
                    expect(viewModel.receivedValue).toBe(234);
                });
            });

            it('Can be configured as an AMD module that supplies a viewmodel configuration', function() {
                var myConstructor = function(params) { this.receivedValue = params.suppliedValue; };
                mockAmdEnvironment(this, { 'some/module/path': { viewModel: myConstructor } });

                testConfigObject({ viewModel: { require: 'some/module/path' } }, function(definition) {
                    var viewModel = definition.createViewModel({ suppliedValue: 345 }, null /* componentInfo */);
                    expect(viewModel.receivedValue).toBe(345);
                });
            });
        });

        describe('Combined viewmodel/templates', function() {
            it('Can be configured as an AMD module', function() {
                var moduleObject = {
                        // The module can have any values that are valid as the input to the whole resolution process
                        template: [],
                        viewModel: function(params) { this.receivedValue = params.suppliedValue; }
                    };
                mockAmdEnvironment(this, { 'some/module/path': moduleObject });

                testConfigObject({ require: 'some/module/path' }, function(definition) {
                    expect(definition.template).toBe(moduleObject.template);

                    var viewModel = definition.createViewModel({ suppliedValue: 567 }, null /* componentInfo */);
                    expect(viewModel.receivedValue).toBe(567);
                });
            });
        });
    });

    function testConfigObject(configObject, assertionCallback) {
        ko.components.unregister(testComponentName);
        ko.components.register(testComponentName, configObject);

        var didComplete = false;
        ko.components.get(testComponentName, function(definition) {
            assertionCallback(definition);
            didComplete = true;
        });

        waitsFor(function() { return didComplete; }, 1000);
    }

    function mockAmdEnvironment(spec, definedModules) {
        spec.restoreAfter(window, 'require');
        window.require = function(modules, callback) {
            expect(modules.length).toBe(1);
            if (modules[0] in definedModules) {
                setTimeout(function() {
                    callback(definedModules[modules[0]]);
                }, 20);
            } else {
                throw new Error('Undefined module: ' + modules[0]);
            }
        };
    }
});
