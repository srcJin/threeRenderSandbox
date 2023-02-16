import {
	ACESFilmicToneMapping,
	NoToneMapping,
	Box3,
	LoadingManager,
	Sphere,
	DoubleSide,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	Group,
	MeshPhysicalMaterial,
	WebGLRenderer,
	Scene,
	PerspectiveCamera,
	OrthographicCamera,
	MeshBasicMaterial,
	sRGBEncoding,
	CustomBlending,
	ColorKeyframeTrack,
	Vector3,
	Color,
	DirectionalLight
} from 'three';
// import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawUtils } from 'three/examples/jsm/utils/LDrawUtils.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { generateRadialFloorTexture } from './utils/generateRadialFloorTexture.js';
import { PathTracingSceneWorker } from '../src/workers/PathTracingSceneWorker.js';
import { PhysicalPathTracingMaterial, PathTracingRenderer, PhysicalCamera, MaterialReducer, BlurredEnvMapGenerator, GradientEquirectTexture } from '../src/index.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {presets,envMaps,qualities} from './presets.js';
import { ShapedAreaLight } from '../src/index.js';
import { FirstPersonControls } from 'three/examples/jsm/controls/FirstPersonControls.js';
// console.log(envMaps['Dusk 1']);
const models = window.MODEL_LIST || {};

let initialModel = Object.keys( models )[ 0 ];
if ( window.location.hash ) {

	const modelName = window.location.hash.substring( 1 ).replaceAll( '%20', ' ' );
	if ( modelName in models ) {

		initialModel = modelName;

	}

}

console.log('presets=',presets);

const focusPoint = new Vector3();



let params = {
	style : "Morning",
	multipleImportanceSampling: true,
	acesToneMapping: true,
	// resolutionScale: 1 / window.devicePixelRatio,
	resolutionScale: 0.5,

	tilesX: 2,
	tilesY: 2,
	samplesPerFrame: 1,

	model: initialModel,

	envMap: envMaps[ 'Dusk 1' ],

	gradientTop: '#bfd8ff',
	gradientBottom: '#ffffff',

	environmentIntensity: 1.0,
	environmentBlur: 0.0,
	environmentRotationY: 0,
	environmentRotationZ: 0,

	cameraProjection: 'Physical',

	backgroundType: 'Gradient',
	bgGradientTop: '#c6e1ff',
	bgGradientBottom: '#ffffff',
	backgroundAlpha: 1.0,
	checkerboardTransparency: true,

	enable: true,
	bounces: 5,
	filterGlossyFactor: 0.5,
	pause: false,

	floorColor: '#494949',
	floorOpacity: 1.0,
	floorRoughness: 1.0,
	floorMetalness: 0.0,

	// Physical Camera
	autoFocus: false,
	focusDistance: 0.1,
	apertureBlades: 6,
	apertureRotation: 0,
	anamorphicRatio: 5 ,
	bokehSize: 0.1 ,
	fStop: 30 ,
	fov: 60,

	// Manual Area Lights
	controls: true,
	areaLight1Enabled: false,
	areaLight1IsCircular: true,
	areaLight1Intensity: 10,
	areaLight1Color: '#ffffff',
	areaLight1Width: 0.5,
	areaLight1Height: 0.5,
	areaLight1X:0,
	areaLight1Y:0,
	areaLight1Z:0,

	directionalLight1Enabled: false,
	directionalLight1Intensity: 10,
	directionalLight1Color: '#ffffff',
	directionalLight1CastShadow : true,
	directionalLight1X:0,
	directionalLight1Y:0,
	directionalLight1Z:0,

	// AO
	radius: 1.0, 
	targetSamples : 200
};



let creditEl, loadingEl, samplesEl;
let floorPlane, gui, stats, sceneInfo;
let renderer, orthoCamera, perspectiveCamera, physicalCamera, activeCamera;
let ptRenderer, fsQuad, controls, scene;
let envMap, envMapGenerator, backgroundMap;
let loadingModel = false;
let delaySamples = 0;
let areaLights = [], directionalLights =[], enabledLights

const orthoWidth = 2;

init();

async function init() {

	creditEl = document.getElementById( 'credits' );
	loadingEl = document.getElementById( 'loading' );
	samplesEl = document.getElementById( 'samples' );

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.outputEncoding = sRGBEncoding;
	renderer.toneMapping = ACESFilmicToneMapping;
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	const aspect = window.innerWidth / window.innerHeight;
	perspectiveCamera = new PerspectiveCamera( 60, aspect, 0.025, 5000 );
	perspectiveCamera.position.set( - 0.75, 0.5, 0.75 );

	const orthoHeight = orthoWidth / aspect;
	orthoCamera = new OrthographicCamera( orthoWidth / - 2, orthoWidth / 2, orthoHeight / 2, orthoHeight / - 2, 0, 10000 );
	orthoCamera.position.set( - 1, 0.25, 1 );

	physicalCamera = new PhysicalCamera( 60, window.innerWidth / window.innerHeight, 0.025, 500 );
	// physicalCamera.position.set( 0.5, 0.5, 0.5 );
	physicalCamera.position.set( -0.1, 0.001, 0.1 );
	physicalCamera.apertureBlades = 6;
	physicalCamera.fStop = 20;
	physicalCamera.focusDistance = 0.055;
	focusPoint.set( 0, 0, 0 );

	backgroundMap = new GradientEquirectTexture();
	backgroundMap.topColor.set( params.bgGradientTop );
	backgroundMap.bottomColor.set( params.bgGradientBottom );
	backgroundMap.update();

	ptRenderer = new PathTracingRenderer( renderer );
	ptRenderer.alpha = true;
	ptRenderer.material = new PhysicalPathTracingMaterial();
	ptRenderer.tiles.set( params.tiles, params.tiles );
	ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params.multipleImportanceSampling ) );
	ptRenderer.material.backgroundMap = backgroundMap;
	ptRenderer.material.transmissiveBounces = 10;

	fsQuad = new FullScreenQuad( new MeshBasicMaterial( {
		map: ptRenderer.target.texture,
		blending: CustomBlending,
		premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
	} ) );

	controls = new OrbitControls( perspectiveCamera, renderer.domElement );
	// first person not working
	// controls = new FirstPersonControls( perspectiveCamera, renderer.domElement );
	controls.addEventListener( 'change', resetRenderer );
	// controls.movementSpeed = 150;
	// controls.lookSpeed = 0.1;

	envMapGenerator = new BlurredEnvMapGenerator( renderer );

	const floorTex = generateRadialFloorTexture( 2048 );
	floorPlane = new Mesh(
		new PlaneGeometry(),
		new MeshStandardMaterial( {
			map: floorTex,
			transparent: true,
			color: 0x111111,
			roughness: 1.0,
			metalness: 0.0,
			side: DoubleSide,
		} )
	);

	floorPlane.scale.setScalar( 5 );
	floorPlane.rotation.x = - Math.PI / 2;
	// floorPlane.position.y = 100;

	console.log( 'floorPlane= ', floorPlane )



	const areaLight1 = new ShapedAreaLight( new Color( 0xFFFFFF ), 5.0, 1.0, 1.0 );
	areaLight1.position.x = 1.5;
	areaLight1.position.y = 2.0;
	areaLight1.position.z = - 0.5;
	areaLight1.rotateZ( - Math.PI / 4 );
	areaLight1.rotateX( - Math.PI / 2 );
	areaLight1.isCircular = true;
	// scene.add( areaLight1 );
	areaLights.push(areaLight1)

	const directionalLight1 = new DirectionalLight( new Color( 0xFFFFFF ), 0.5 );
	directionalLight1.position.x = 1.5;
	directionalLight1.position.y = 2.0;
	directionalLight1.position.z = -0.5;

	// scene.add( directionalLight1 );
	directionalLights.push(directionalLight1)

	stats = new Stats();
	document.body.appendChild( stats.dom );
	renderer.physicallyCorrectLights = true;
	renderer.toneMapping = ACESFilmicToneMapping;
	scene.background = backgroundMap;
	ptRenderer.tiles.set( params.tilesX, params.tilesY );

	updateCamera( params.cameraProjection );
	updateModel();
	updateEnvMap();
	onResize();

	animate();

	window.addEventListener( 'resize', onResize );

}

function animate() {

	requestAnimationFrame( animate );

	stats.update();

	if ( loadingModel ) {

		return;

	}

	floorPlane.material.color.set( params.floorColor );
	floorPlane.material.roughness = params.floorRoughness;
	floorPlane.material.metalness = params.floorMetalness;
	floorPlane.material.opacity = params.floorOpacity;

	if ( ptRenderer.samples < 1.0 || ! params.enable ) {

		renderer.render( scene, activeCamera );

	}

	if ( params.enable && delaySamples === 0 && ptRenderer.samples <= params.targetSamples ) {

		const samples = Math.floor( ptRenderer.samples );
		samplesEl.innerText = `samples: ${ samples }`;

		ptRenderer.material.materials.updateFrom( sceneInfo.materials, sceneInfo.textures );
		ptRenderer.material.filterGlossyFactor = params.filterGlossyFactor;
		ptRenderer.material.environmentIntensity = params.environmentIntensity;
		ptRenderer.material.bounces = params.bounces;
		ptRenderer.material.physicalCamera.updateFrom( activeCamera );

		activeCamera.updateMatrixWorld();

		if ( ! params.pause || ptRenderer.samples < 1 ) {

			for ( let i = 0, l = params.samplesPerFrame; i < l; i ++ ) {

				ptRenderer.update();

			}

		}

		renderer.autoClear = false;
		fsQuad.render( renderer );
		renderer.autoClear = true;

	} else if ( delaySamples > 0 ) {

		delaySamples --;

	}

	samplesEl.innerText = `Samples: ${ Math.floor( ptRenderer.samples ) }`;

}

function resetRenderer() {

	if ( params.tilesX * params.tilesY !== 1.0 ) {

		delaySamples = 1;

	}

	ptRenderer.reset();

}

function onResize() {

	const w = window.innerWidth;
	const h = window.innerHeight;
	const scale = params.resolutionScale;
	const dpr = window.devicePixelRatio;

	ptRenderer.setSize( w * scale * dpr, h * scale * dpr );
	ptRenderer.reset();

	renderer.setSize( w, h );
	renderer.setPixelRatio( window.devicePixelRatio * scale );

	const aspect = w / h;
	perspectiveCamera.aspect = aspect;
	perspectiveCamera.updateProjectionMatrix();

	const orthoHeight = orthoWidth / aspect;
	orthoCamera.top = orthoHeight / 2;
	orthoCamera.bottom = orthoHeight / - 2;
	orthoCamera.updateProjectionMatrix();

}

// saved parameters, a global variable
let saved = {}
let savedGui = {}
let data
function downloadJson(exportObj, exportName){
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    let downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", exportName + ".json");
    downloadAnchorNode.click();
}

function loadJson() {
	let input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json';
	input.addEventListener('change', function(event) {
		let file = event.target.files[0];
		let reader = new FileReader();
		reader.onload = function(event) {
		data = JSON.parse(event.target.result);
		console.log("loadJson()=", data);
			};
		reader.readAsText(file);
	});
	input.click();
	return data
}

// Material Presets
const materialPresets = {
	'Half Transparent': {
		color: 0x8597A2,
		roughness: 0.7,
		metalness: 0.015,
		transparent: true,
		opacity: 0.15
	},
	'Maquette': {
		color: 0xCEA16A,
		roughness: 0.9,
		metalness: 0.01
	},
	'Blue Foam': {
		color: 0x539EBE,
		roughness: 0.7,
		metalness: 0.01,
	},
	'Arctic': {
		color: 0xF5F5F5,
		roughness: 0.2,
		metalness: 0,
		emissiveIntensity: 0.05,
		emissive: 0xFFFFCC,
	}
};

function buildGui() {

	if ( gui ) {

		gui.destroy();

	}

	gui = new GUI();
	const folderParams = { 
		save() { 
			saved = params;
			// savedGui = gui.save();
			console.log( 'save', saved );
			downloadJson(saved, 'params');
			// downloadJson(savedGui, 'gui');

			},

		load(){
			let load = loadJson();
			loadSettings(load)
		}
	}

	const saveLoadFolder = gui.addFolder( 'Save/Load' );
	saveLoadFolder.add( folderParams, 'save' );
	saveLoadFolder.add( folderParams, 'load' );
	saveLoadFolder.close();


	const GeneralFolder = gui.addFolder( 'General' );

	GeneralFolder.add( params, 'model', Object.keys( models ) ).onChange( updateModel);
	GeneralFolder.add( params, 'model' ).name( 'Model URL' ).onFinishChange( updateModel );

	GeneralFolder.add( params, 'style', Object.keys( presets ) ).onChange( v => {
		refreshAll(v)
	})

	GeneralFolder.add( params, 'Quality', Object.keys( qualities ) ).onChange( v => {
		refreshQuality(v)
	}),

	GeneralFolder.add( params, 'targetSamples', 50,500,1 ).name('Samples').onChange(ptRenderer.reset())



	const areaLight1Folder = gui.addFolder( 'Area Light 1' );
	areaLight1Folder.add( params, 'areaLight1Enabled' ).name( 'enable' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1IsCircular' ).name( 'isCircular' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Intensity', 0, 400 ).name( 'intensity' ).onChange( updateLights );
	areaLight1Folder.addColor( params, 'areaLight1Color' ).name( 'color' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Width', 0, 5 ).name( 'width' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1Height', 0, 5 ).name( 'height' ).onChange( updateLights );
	areaLight1Folder.add( params, 'areaLight1X', -3.14,3.14).name ('Axis 1').onChange(updateLights);
	areaLight1Folder.add( params, 'areaLight1Y', 0,3.14).name ('Axis 2').onChange(updateLights);


	const directionalLight1Folder = gui.addFolder( 'directional Light 1' );
	directionalLight1Folder.add( params, 'directionalLight1Enabled' ).name( 'enable_2' ).onChange( updateLights );
	directionalLight1Folder.add( params, 'directionalLight1CastShadow' ).name( 'CastShadow' ).onChange( updateLights );
	directionalLight1Folder.add( params, 'directionalLight1Intensity', 0, 200 ).name( 'intensity' ).onChange( updateLights );
	directionalLight1Folder.addColor( params, 'directionalLight1Color' ).name( 'color' ).onChange( updateLights );	
	directionalLight1Folder.add( params, 'directionalLight1X', -3.14,3.14).name ('Axis 1_2').onChange(updateLights);
	directionalLight1Folder.add( params, 'directionalLight1Y',  0,3.14).name ('Axis 2_2').onChange(updateLights);
	directionalLight1Folder.close()

	updateLights();

	function updateLights() {

		// rotate the light around a pivot
		// https://jsfiddle.net/tfoller/pyawcqxk/15/

		areaLights[ 0 ].isCircular = params.areaLight1IsCircular;
		areaLights[ 0 ].intensity = params.areaLight1Intensity;
		areaLights[ 0 ].width = params.areaLight1Width;
		areaLights[ 0 ].height = params.areaLight1Height;
		areaLights[ 0 ].color.set( params.areaLight1Color ).convertSRGBToLinear();
		areaLights[ 0 ].lookAt( 0, 0, 0 )

		directionalLights[ 0 ].intensity = params.directionalLight1Intensity;
		directionalLights[ 0 ].color.set( params.directionalLight1Color ).convertSRGBToLinear();
		directionalLights[ 0 ].castShadow = params.directionalLight1CastShadow


		var pt = [0,0,1]
		var pt2 = rotatePt(pt[0],pt[2], params.areaLight1X) // check conversion from three.js
		var pt3 = rotatePt(pt2[0],pt[1], params.areaLight1Y)

		var pt2_2 = rotatePt(pt[0],pt[2], params.directionalLight1X) // check conversion from three.js
		var pt3_2 = rotatePt(pt2_2[0],pt[1], params.directionalLight1Y)

		let newAreaLightPosition = new Vector3(pt3[0], pt3[1], pt2[1])
		let newDirectionalLightPosition = new Vector3(pt3_2[0], pt3_2[1], pt2_2[1])

		areaLights[ 0 ].position.x = newAreaLightPosition.x;
		areaLights[ 0 ].position.y = newAreaLightPosition.y;
		areaLights[ 0 ].position.z = newAreaLightPosition.z;

		directionalLights[ 0 ].position.x = newDirectionalLightPosition.x;
		directionalLights[ 0 ].position.y = newDirectionalLightPosition.y;
		directionalLights[ 0 ].position.z = newDirectionalLightPosition.z;

		enabledLights = [];

		if ( params.areaLight1Enabled ) enabledLights.push( areaLights[ 0 ] );
		if ( params.directionalLight1Enabled ) enabledLights.push( directionalLights[ 0 ] );
		directionalLights[ 0 ].visible = (params.directionalLight1Enabled) ? true : false

		console.log("enabledLights",enabledLights);
		ptRenderer.material.lights.updateFrom( enabledLights );
		ptRenderer.reset();

		function rotatePt(px, py, angle){

			var nx = px * Math.cos(angle) - py * Math.sin(angle);
			var ny = py * Math.cos(angle) + px * Math.sin(angle);
			return [nx, ny]
	
	  }
	
	
	}


	
	const materialParams = {
		preset: 'Blue Foam'
	};
	
	const materialFolder = gui.addFolder('Material');
	materialFolder.add(materialParams, 'preset', ['Half Transparent', 'Maquette', 'Blue Foam', 'Arctic']).name('Presets').onChange(() => {
		const preset = materialPresets[materialParams.preset];
		
		for (let i = 0; i < model.children.length; i++) {
			updateMaterial(model.children[i], preset);
		}
	});
	

	materialFolder.open();	

	const pathTracingFolder = gui.addFolder( 'path tracing' );
	pathTracingFolder.add( params, 'enable' );
	pathTracingFolder.add( params, 'pause' );
	pathTracingFolder.add( params, 'multipleImportanceSampling' ).onChange( v => {

		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( v ) );
		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'acesToneMapping' ).onChange( v => {

		renderer.toneMapping = v ? ACESFilmicToneMapping : NoToneMapping;

	} );
	pathTracingFolder.add( params, 'bounces', 1, 20, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	pathTracingFolder.add( params, 'filterGlossyFactor', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );

	const resolutionFolder = gui.addFolder( 'resolution' );
	resolutionFolder.add( params, 'resolutionScale', 0.1, 1.0, 0.01 ).onChange( () => {

		onResize();

	} );
	resolutionFolder.add( params, 'samplesPerFrame', 1, 10, 1 );
	resolutionFolder.add( params, 'tilesX', 1, 10, 1 ).onChange( v => {

		ptRenderer.tiles.x = v;

	} );
	resolutionFolder.add( params, 'tilesY', 1, 10, 1 ).onChange( v => {

		ptRenderer.tiles.y = v;

	} );
	resolutionFolder.add( params, 'cameraProjection', [ 'Perspective', 'Orthographic','Physical' ] ).onChange( v => {

		updateCamera( v );
		if (v == 'Physical'){
			cameraFolder.show()
			cameraFolder.open()
		} else {
			cameraFolder.hide()
		}

	} );
	resolutionFolder.open();

	const environmentFolder = gui.addFolder( 'environment' );
	environmentFolder.add( params, 'envMap', envMaps ).name( 'map' ).onChange( updateEnvMap );
	environmentFolder.add( params, 'envMap' ).name( 'HDRI URL' ).onFinishChange( updateEnvMap );
	environmentFolder.add( params, 'environmentBlur', 0.0, 1.0 ).onChange( () => {

		updateEnvBlur();
		ptRenderer.reset();

	} ).name( 'env map blur' );
	environmentFolder.add( params, 'environmentIntensity', 0.0, 5.0 ).onChange( () => {

		ptRenderer.reset();

	} ).name( 'intensity' );
	environmentFolder.add( params, 'environmentRotationY', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.makeRotationY( v );
		ptRenderer.reset();

	} );
	environmentFolder.add( params, 'environmentRotationZ', 0, 2 * Math.PI ).onChange( v => {

		ptRenderer.material.environmentRotation.makeRotationZ( v );
		ptRenderer.reset();

	} );
	environmentFolder.open();

	const backgroundFolder = gui.addFolder( 'background' );
	backgroundFolder.add( params, 'backgroundType', [ 'Environment', 'Gradient' ] ).onChange( v => {

		if ( v === 'Gradient' ) {

			scene.background = backgroundMap;
			ptRenderer.material.backgroundMap = backgroundMap;

		} else {

			scene.background = scene.environment;
			ptRenderer.material.backgroundMap = null;

		}

		ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientTop' ).onChange( v => {

		backgroundMap.topColor.set( v );
		backgroundMap.update();

		ptRenderer.reset();

	} );
	backgroundFolder.addColor( params, 'bgGradientBottom' ).onChange( v => {

		backgroundMap.bottomColor.set( v );
		backgroundMap.update();

		ptRenderer.reset();

	} );
	backgroundFolder.add( params, 'backgroundAlpha', 0, 1 ).onChange( v => {

		ptRenderer.material.backgroundAlpha = v;
		ptRenderer.reset();

	} );
	backgroundFolder.add( params, 'checkerboardTransparency' ).onChange( v => {

		if ( v ) document.body.classList.add( 'checkerboard' );
		else document.body.classList.remove( 'checkerboard' );

	} );

	const floorFolder = gui.addFolder( 'floor' );
	floorFolder.addColor( params, 'floorColor' ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorRoughness', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorMetalness', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.add( params, 'floorOpacity', 0, 1 ).onChange( () => {

		ptRenderer.reset();

	} );
	floorFolder.open();

	const MaterialFolder = gui.addFolder( 'Material' );
	MaterialFolder.add( params, 'radius', 0, 4 ).onChange( () => {

		ptRenderer.reset();

	} );

	const cameraFolder = gui.addFolder( 'PhysicalCamera' );
	cameraFolder.add( physicalCamera, 'focusDistance', 0.0001, 5 ).onChange( ptRenderer.reset() ).listen();
	cameraFolder.add( physicalCamera, 'apertureBlades', 0, 10, 1 ).onChange( function ( v ) {

		physicalCamera.apertureBlades = v === 0 ? 0 : Math.max( v, 3 );
		this.updateDisplay();
		refreshAll(v) 
		ptRenderer.reset();

	} );
	cameraFolder.add( physicalCamera, 'apertureRotation', 0, 12.5 ).onChange( ptRenderer.reset() );
	cameraFolder.add( physicalCamera, 'anamorphicRatio', 0.1, 10.0 ).onChange( ptRenderer.reset() );
	cameraFolder.add( physicalCamera, 'bokehSize', 0, 500 ).onChange( ptRenderer.reset() ).listen();
	cameraFolder.add( physicalCamera, 'fStop', 0.02, 100 ).onChange( ptRenderer.reset() ).listen();
	cameraFolder.add( physicalCamera, 'fov', 25, 100 ).onChange( () => {

		physicalCamera.updateProjectionMatrix();
		ptRenderer.reset();
	} ).listen();
	cameraFolder.add( params, 'autoFocus' );
	// cameraFolder.hide()


	function loadSettings(object){
		for ( key in object ){
			console.log(key)
			params[key] = object[key]
		};
		buildGui();
	}

	function refreshQuality(v){
		for (key in qualities[v]){
			// console.log(object)
			params[key] = qualities[v][key]
		};
		buildGui();
	}


	function refreshAll(v) {
		for (key in presets[v]){
			// console.log(object)
			params[key] = presets[v][key]
		}

		// params = presets[v]
		// refresh everything
		ptRenderer.material.setDefine( 'FEATURE_MIS', Number( params['multipleImportanceSampling'] ) );
		renderer.toneMapping = params['acesToneMapping'] ? ACESFilmicToneMapping : NoToneMapping;
		onResize();
		ptRenderer.tiles.x = params.tilesX;
		ptRenderer.tiles.y = params.tilesY;
		updateCamera( params['cameraProjection'] );
		updateEnvMap();
		updateEnvBlur();
		ptRenderer.material.environmentRotation.makeRotationY( params.environmentRotationY );
		ptRenderer.material.environmentRotation.makeRotationZ( params.environmentRotationZ );

		if ( params.backgroundType === 'Gradient' ) {
			scene.background = backgroundMap;
			ptRenderer.material.backgroundMap = backgroundMap;
		} else {
			scene.background = scene.environment;
			ptRenderer.material.backgroundMap = null;
		}
		backgroundMap.topColor.set( params.bgGradientTop );
		backgroundMap.topColor.set( params.bgGradientBottom );
		ptRenderer.material.backgroundAlpha = params.backgroundAlpha

		if ( params.checkerboardTransparency ) document.body.classList.add( 'checkerboard' );
		else document.body.classList.remove( 'checkerboard' );

		ptRenderer.reset();

		buildGui()
		console.log('refreshAll');
	}
}

function updateEnvMap() {

	new RGBELoader()
		.load( params.envMap, texture => {

			if ( scene.environmentMap ) {

				scene.environment.dispose();
				envMap.dispose();

			}

			envMap = texture;
			updateEnvBlur();
			ptRenderer.reset();

		} );

}

function updateEnvBlur() {

	const blurredEnvMap = envMapGenerator.generate( envMap, params.environmentBlur );
	ptRenderer.material.envMapInfo.updateFrom( blurredEnvMap );

	scene.environment = blurredEnvMap;
	if ( params.backgroundType !== 'Gradient' ) {

		scene.background = blurredEnvMap;

	}

}

function updateCamera( cameraProjection ) {

	if ( cameraProjection === 'Perspective' ) {

		if ( activeCamera ) {

			perspectiveCamera.position.copy( activeCamera.position );

		}

		activeCamera = perspectiveCamera;

	} else if  ( cameraProjection === 'Physical' ) {
		if ( activeCamera ) {

			physicalCamera.position.copy( activeCamera.position );

		}

		activeCamera = physicalCamera;

	}
	
	else {

		if ( activeCamera ) {

			orthoCamera.position.copy( activeCamera.position );

		}

		activeCamera = orthoCamera;

	}
	console.log("activeCamera.position=",activeCamera.position);
	controls.object = activeCamera;
	ptRenderer.camera = activeCamera;
	controls.update();

	resetRenderer();

}

function convertOpacityToTransmission( model, ior ) {

	model.traverse( c => {

		if ( c.material ) {

			const material = c.material;
			if ( material.opacity < 0.65 && material.opacity > 0.2 ) {

				const newMaterial = new MeshPhysicalMaterial();
				for ( const key in material ) {

					if ( key in material ) {

						if ( material[ key ] === null ) {

							continue;

						}

						if ( material[ key ].isTexture ) {

							newMaterial[ key ] = material[ key ];

						} else if ( material[ key ].copy && material[ key ].constructor === newMaterial[ key ].constructor ) {

							newMaterial[ key ].copy( material[ key ] );

						} else if ( ( typeof material[ key ] ) === 'number' ) {

							newMaterial[ key ] = material[ key ];

						}

					}

				}

				newMaterial.opacity = 1.0;
				newMaterial.transmission = 1.0;
				newMaterial.ior = ior;

				const hsl = {};
				newMaterial.color.getHSL( hsl );
				hsl.l = Math.max( hsl.l, 0.35 );
				newMaterial.color.setHSL( hsl.h, hsl.s, hsl.l );

				c.material = newMaterial;

			}

		}

	} );

}

let model;

function updateMaterial(object, preset) {
	if (object.type === "Mesh") {
		if (object.material && object.material.map !== null) {
			// Skip this mesh and its children since it has a custom texture
			return;
		}
		object.material = new MeshStandardMaterial(preset);
	}

	for (let i = 0; i < object.children.length; i++) {
		updateMaterial(object.children[i], preset);
	}
}


async function updateModel() {

	if ( gui ) {

		document.body.classList.remove( 'checkerboard' );
		gui.destroy();
		gui = null;

	}
	const manager = new LoadingManager();
	const modelInfo = models[ params.model ];

	loadingModel = true;
	renderer.domElement.style.visibility = 'hidden';
	samplesEl.innerText = '--';
	creditEl.innerText = '--';
	loadingEl.innerText = 'Loading';
	loadingEl.style.visibility = 'visible';

	scene.traverse( c => {

		if ( c.material ) {

			const material = c.material;
			for ( const key in material ) {

				if ( material[ key ] && material[ key ].isTexture ) {

					material[ key ].dispose();

				}

			}

		}

	} );

	if ( sceneInfo ) {

		scene.remove( sceneInfo.scene );

	}


	const onFinish = async () => {

		if ( modelInfo.removeEmission ) {

			model.traverse( c => {

				if ( c.material ) {

					c.material.emissiveMap = null;
					c.material.emissiveIntensity = 0;

				}

			} );

		}

		if ( modelInfo.opacityToTransmission ) {

			console.log( 'model=', model );
			convertOpacityToTransmission( model, modelInfo.ior || 1.5 );

		}

		model.traverse( c => {

			if ( c.material ) {

				// set the thickness so we render the material as a volumetric object
				c.material.thickness = 1.0;

			}

		} );

		if ( modelInfo.postProcess ) {

			modelInfo.postProcess( model );

		}

		// rotate model after so it doesn't affect the bounding sphere scale
		if ( modelInfo.rotation ) {

			model.rotation.set( ...modelInfo.rotation );

		}

		// center the model
		const box = new Box3();
		box.setFromObject( model );
		model.position
			.addScaledVector( box.min, - 0.5 )
			.addScaledVector( box.max, - 0.5 );
		const sphere = new Sphere();
		box.getBoundingSphere( sphere );

		model.scale.setScalar( 1 / sphere.radius );
		model.position.multiplyScalar( 1 / sphere.radius );

		box.setFromObject( model );

		model.updateMatrixWorld();

		const group = new Group();
		// changed to fit DBF model
		floorPlane.position.y = box.min.y+0.00125;
		group.add( model, floorPlane );

		const reducer = new MaterialReducer();
		reducer.process( group );

		const generator = new PathTracingSceneWorker();
		const result = await generator.generate( group, { onProgress: v => {

			const percent = Math.floor( 100 * v );
			loadingEl.innerText = `Building BVH : ${ percent }%`;

		} } );

		sceneInfo = result;
		scene.add( sceneInfo.scene );




		const { bvh, textures, materials } = result;
		const geometry = bvh.geometry;
		const material = ptRenderer.material;

		material.bvh.updateFrom( bvh );
		material.attributesArray.updateFrom(
			geometry.attributes.normal,
			geometry.attributes.tangent,
			geometry.attributes.uv,
			geometry.attributes.color,
		);
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.textures.setTextures( renderer, 1024, 1024, textures );
		material.materials.updateFrom( materials, textures );

		generator.dispose();

		loadingEl.style.visibility = 'hidden';

		creditEl.innerHTML = modelInfo.credit || '';
		creditEl.style.visibility = modelInfo.credit ? 'visible' : 'hidden';
		// params.bounces = modelInfo.bounces || 5;
		// params.floorColor = modelInfo.floorColor || '#3f3f3f';
		// params.floorRoughness = modelInfo.floorRoughness || 1.0;
		// params.floorMetalness = modelInfo.floorMetalness || 0.0;
		// params.bgGradientTop = modelInfo.gradientTop || '#111111';
		// params.bgGradientBottom = modelInfo.gradientBot || '#000000';

		backgroundMap.topColor.set( params.bgGradientTop );
		backgroundMap.bottomColor.set( params.bgGradientBottom );
		backgroundMap.update();

		buildGui();

		loadingModel = false;
		renderer.domElement.style.visibility = 'visible';
		if ( params.checkerboardTransparency ) {

			document.body.classList.add( 'checkerboard' );

		}

		ptRenderer.reset();

	};

	const url = modelInfo.url;
	if ( /(gltf|glb)$/i.test( url ) ) {
		console.log( 'url=', url );
		manager.onLoad = onFinish;
		new GLTFLoader( manager )
			.setMeshoptDecoder( MeshoptDecoder )
			.load(
				url,
				gltf => {

					console.log( 'gltf=', gltf );
					model = gltf.scene;
					console.log(model.children);

					for (var i = 0; i < model.children.length; i++) {
						updateMaterial(model.children[i], materialPresets['Blue Foam']);
					}			

				},
				progress => {

					if ( progress.total !== 0 && progress.total >= progress.loaded ) {

						const percent = Math.floor( 100 * progress.loaded / progress.total );
						loadingEl.innerText = `Loading : ${ percent }%`;

					}

				},
			);

	} else if ( /mpd$/i.test( url ) ) {

		let failed = false;
		manager.onProgress = ( url, loaded, total ) => {

			if ( failed ) {

				return;

			}

			const percent = Math.floor( 100 * loaded / total );
			loadingEl.innerText = `Loading : ${ percent }%`;

		};

		const loader = new LDrawLoader( manager );
		await loader.preloadMaterials( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/colors/ldcfgalt.ldr' );
		loader
			.setPartsLibraryPath( 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/' )
			.load(
				url,
				result => {

					model = LDrawUtils.mergeObject( result );
					model.rotation.set( Math.PI, 0, 0 );

					const toRemove = [];
					model.traverse( c => {

						if ( c.isLineSegments ) {

							toRemove.push( c );

						}

						if ( c.isMesh ) {

							c.material.roughness *= 0.25;

						}

					} );

					toRemove.forEach( c => {

						c.parent.remove( c );

					} );

					onFinish();

				},
				undefined,
				err => {

					failed = true;
					loadingEl.innerText = 'Failed to load model. ' + err.message;

				}

			);

	}

}
