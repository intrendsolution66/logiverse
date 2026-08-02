// frontend/src/worklets/playAlongPitchProcessor.js
//
// 只做一件事：纯变调（音高变，速度不变），不管变速——变速交给
// PlayAlongViewerPage.tsx 里 <audio> 元素自带的 playbackRate/
// preservesPitch 去做，这里不用重复处理，范围越小、自己写的实时DSP出
// 问题的地方就越少。
//
// 内部还是借用 soundtouchjs 的核心算法(SoundTouch/SimpleFilter那一套)，
// 只是把它的 tempo 参数钉死在1（只留 pitch 可调）。SoundTouch 做"纯变调"
// 的原理是先用简单重采样把音高和速度一起变了(pitch比例)，再用WSOLA时间
// 拉伸把速度拉回原状(这一步本身是保音高的)，最后净效果就是"音高变了、
// 速度没变"——这不是我们发明的取巧做法，是 SoundTouch 本来内部就这样
// 实现pitch参数的，我们只是把tempo参数锁住不让它同时也变速。
//
// 运行在独立的音频渲染线程上(AudioWorkletGlobalScope)，不是主线程——
// 主线程卡顿(比如切标签页、页面在做别的运算)不会连累这里丢帧/爆音，
// 这是选它而不是 ScriptProcessorNode 的原因。
//
// 已知需要在实际环境验证/调优的地方（我这边没有能跑浏览器音频的环境）：
//   1. 下面 SOURCE_BUFFER_FRAMES / process() 里的缓冲策略——如果听到
//      卡顿或者延迟明显，通常是这个缓冲区大小要调
//   2. seek(跳转播放位置)之后，worklet 内部残留的处理状态(SoundTouch的
//      内部缓冲区)理论上该清空重置，不然刚跳转完那一瞬间可能会有一点
//      杂音——下面 'seek' 消息处理里已经调用 clear()，但实际效果要测
//   3. import { SoundTouch, SimpleFilter } from 'soundtouchjs' 这一行
//      能不能在 AudioWorklet 模块里正常解析，取决于 Vite 处理 worklet
//      模块的方式——PlayAlongViewerPage.tsx 里用
//      `new URL('./playAlongPitchProcessor.js', import.meta.url)` 这个
//      写法交给 Vite 处理，这是 Vite 官方文档说明支持的 worklet 加载方式，
//      但没有在这个项目实跑过，需要你确认能正常 build。

import { SoundTouch, SimpleFilter } from "soundtouchjs";

const SOURCE_BUFFER_FRAMES = 4096; // 累积这么多帧才丢给SoundTouch处理一批，太小会处理开销占比过高，太大会增加延迟

// 一个符合 soundtouchjs Source 接口的适配器——把 AudioWorkletProcessor
// process() 里每次拿到的一小块(通常128帧)输入，先攒进一个环形缓冲区，
// SimpleFilter 需要样本的时候从这个缓冲区里"extract"出去。
class StreamingSource {
  constructor() {
    this.buffer = new Float32Array(SOURCE_BUFFER_FRAMES * 2 * 4); // *2声道 *4倍余量，够用又不用频繁扩容
    this.writeIndex = 0; // 下一个要写入的位置(交织的L/R样本计数，不是帧数)
    this.readIndex = 0;
  }

  // AudioWorkletProcessor 每次 process() 调用时，把新到的输入样本追加
  // 进来(交织成 LRLRLR... 格式，SimpleFilter 要这个格式)。
  push(inputL, inputR) {
    const frames = inputL.length;
    // 缓冲区快满了就把已经读过的部分往前挪，腾出空间——避免无限增长
    if (this.writeIndex + frames * 2 > this.buffer.length) {
      this.buffer.copyWithin(0, this.readIndex, this.writeIndex);
      this.writeIndex -= this.readIndex;
      this.readIndex = 0;
    }
    for (let i = 0; i < frames; i++) {
      this.buffer[this.writeIndex++] = inputL[i];
      this.buffer[this.writeIndex++] = inputR ? inputR[i] : inputL[i];
    }
  }

  // soundtouchjs 的 SimpleFilter 会调用这个方法要样本——target是要写入的
  // Float32Array，numFrames是想要多少帧，返回实际给了多少帧。
  extract(target, numFrames) {
    const available = (this.writeIndex - this.readIndex) / 2;
    const framesToCopy = Math.min(numFrames, available);
    for (let i = 0; i < framesToCopy * 2; i++) {
      target[i] = this.buffer[this.readIndex + i];
    }
    this.readIndex += framesToCopy * 2;
    return framesToCopy;
  }

  clear() {
    this.writeIndex = 0;
    this.readIndex = 0;
  }
}

class PlayAlongPitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.soundTouch = new SoundTouch();
    this.soundTouch.tempo = 1; // 钉死——变速不归这里管
    this.soundTouch.pitch = 1; // 1 = 原调，运行中靠下面的message动态改

    this.source = new StreamingSource();
    this.filter = new SimpleFilter(this.source, this.soundTouch);

    this.outputTail = new Float32Array(0); // 上一次 extract 多拿出来但这一帧还用不完的样本，留到下一次 process() 用
    this.extractBuffer = new Float32Array(SOURCE_BUFFER_FRAMES * 2);

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "setPitchCents") {
        this.soundTouch.pitch = Math.pow(2, msg.cents / 1200);
      } else if (msg.type === "reset") {
        // 跳转播放位置之后调用——清掉内部残留的样本，避免跳转前的尾巴
        // 声音跟跳转后的开头叠在一起
        this.source.clear();
        this.filter.sourcePosition = 0;
        this.outputTail = new Float32Array(0);
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      // 还没有输入数据（比如刚连上、还在缓冲）——静音跳过，不报错
      return true;
    }

    this.source.push(input[0], input[1]);

    const framesNeeded = output[0].length;
    let outIdx = 0;
    const outL = output[0];
    const outR = output[1] ?? output[0];

    // 先用上次剩的尾巴
    while (outIdx < framesNeeded && this.outputTail.length > outIdx * 2 + 1) {
      outL[outIdx] = this.outputTail[outIdx * 2];
      outR[outIdx] = this.outputTail[outIdx * 2 + 1];
      outIdx++;
    }
    const consumedFromTail = outIdx;

    if (outIdx < framesNeeded) {
      const got = this.filter.extract(this.extractBuffer, SOURCE_BUFFER_FRAMES);
      let bufIdx = 0;
      while (outIdx < framesNeeded && bufIdx < got) {
        outL[outIdx] = this.extractBuffer[bufIdx * 2];
        outR[outIdx] = this.extractBuffer[bufIdx * 2 + 1];
        outIdx++; bufIdx++;
      }
      // 这批比这一帧需要的多，剩下的存到 outputTail 留给下一次 process()
      if (bufIdx < got) {
        const remaining = got - bufIdx;
        this.outputTail = new Float32Array(remaining * 2);
        for (let i = 0; i < remaining; i++) {
          this.outputTail[i * 2] = this.extractBuffer[(bufIdx + i) * 2];
          this.outputTail[i * 2 + 1] = this.extractBuffer[(bufIdx + i) * 2 + 1];
        }
      } else {
        this.outputTail = new Float32Array(0);
      }
    } else {
      // 这一帧全靠上次的尾巴就够了，把用掉的部分从 outputTail 里切掉
      const remaining = this.outputTail.length / 2 - consumedFromTail;
      if (remaining > 0) {
        this.outputTail = this.outputTail.slice(consumedFromTail * 2);
      } else {
        this.outputTail = new Float32Array(0);
      }
    }

    return true;
  }
}

registerProcessor("play-along-pitch-processor", PlayAlongPitchProcessor);
