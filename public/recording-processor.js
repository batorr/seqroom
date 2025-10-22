class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global variable in AudioWorkletGlobalScope
    this.port.postMessage({
      type: 'ready',
      sampleRate,
    });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channelCount = input.length;
    const frameCount = input[0].length;
    const interleaved = new Float32Array(channelCount * frameCount);

    let offset = 0;
    for (let i = 0; i < frameCount; i += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        interleaved[offset] = input[channel][i] ?? 0;
        offset += 1;
      }
    }

    this.port.postMessage(
      {
        type: 'data',
        channelCount,
        buffer: interleaved.buffer,
      },
      [interleaved.buffer],
    );

    return true;
  }
}

registerProcessor('seqroom-recorder', RecorderProcessor);
