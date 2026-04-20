(() => {
	const setupSelect = document.getElementById('setupName');
	const telescopeParams = document.getElementById('telescopeParams');
	const focalLengthInput = document.getElementById('focalLength');
	const sensorWidthInput = document.getElementById('sensorW');
	const sensorHeightInput = document.getElementById('sensorH');
	const pixelSizeInput = document.getElementById('pixSize');
	const resolutionNxInput = document.getElementById('nx');
	const resolutionNyInput = document.getElementById('ny');

	const setupFields = [
		focalLengthInput,
		sensorWidthInput,
		sensorHeightInput,
		pixelSizeInput,
		resolutionNxInput,
		resolutionNyInput
	];

	function setFieldValue(field, value) {
		if (!field) return;
		field.value = value;
	}

	function applySetup(setup) {
		if (!setup) return;
		setFieldValue(focalLengthInput, setup.FocalLength);
		setFieldValue(sensorWidthInput, setup.SensorWidth);
		setFieldValue(sensorHeightInput, setup.SensorHeight);
		setFieldValue(pixelSizeInput, setup.PixelSize);
		setFieldValue(resolutionNxInput, setup.ResolutionNX);
		setFieldValue(resolutionNyInput, setup.ResolutionNY);
	}

	function populateSetupOptions(setups) {
		setupSelect.innerHTML = '';

		setups.forEach((setup, index) => {
			const option = document.createElement('option');
			option.value = String(index);
			option.textContent = `${setup.Telescope}`;
			setupSelect.appendChild(option);
		});
	}

	function bindSetupChange(setups) {
		setupSelect.addEventListener('change', () => {
			const index = Number.parseInt(setupSelect.value, 10);
			applySetup(setups[index]);
			if (typeof window.safeUpdate === 'function') {
				window.safeUpdate();
			}
		});
	}

	async function loadSetups() {
		const response = await fetch('Piers.json', { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`Failed to load Piers.json (${response.status})`);
		}

		const setups = await response.json();
		if (!Array.isArray(setups) || setups.length === 0) {
			throw new Error('Piers.json did not contain any telescope setups');
		}

		populateSetupOptions(setups);
		bindSetupChange(setups);
		setupSelect.value = '0';
		applySetup(setups[0]);

		setupFields.forEach((field) => {
			if (field) field.disabled = true;
		});

		telescopeParams.dataset.loadedFrom = 'Piers.json';
	}

	document.addEventListener('DOMContentLoaded', () => {
		loadSetups().catch((error) => {
			setupSelect.innerHTML = '<option value="">Failed to load setups</option>';
			setupSelect.disabled = true;
			console.error(error);
			telescopeParams.title = error.message || String(error);
		});
	});
})();
