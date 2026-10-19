import { describe, expect, it } from 'vitest';
import { frameDocument, validState, validateArtifact } from './frameProtocol';
import { initialLabState, type GeneratedComponent } from './types';

const artifact = (): GeneratedComponent => ({ title:'Rhythm',explanation:'A local tool',html:'<button>Tap</button>',css:'button{color:#345}',js:'api.expose({start(){},stop(){},tap(){},classify(){return "on-time"}});api.ready();',settings:initialLabState().settings });
describe('generated component boundary',()=>{
  it('allows function declarations but rejects the Function constructor',()=>{
    expect(validateArtifact({...artifact(),js:'function start() {} api.ready();'})).toBeNull();
    expect(validateArtifact({...artifact(),js:'new Function("return 1")()'})).not.toBeNull();
  });
  it('accepts custom markup, SVG and behavior without choosing a template',()=>{
    const a=artifact();a.html='<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg><button>เคาะ</button>';
    expect(validateArtifact(a)).toBeNull();
  });
  it.each(['<script>alert(1)</script>','<iframe src="https://example.com"></iframe>','<img src=x onerror="alert(1)">','<button onclick="alert(1)">tap</button>','<a href="https://example.com">go</a>'])( 'rejects active or remote markup %s',html=>expect(validateArtifact({...artifact(),html})).not.toBeNull());
  it.each(['fetch("/api")','parent.postMessage({})','localStorage.setItem("x","y")','import("https://example.com/x.js")','location.href="https://example.com"','</script><script>alert(1)</script>'])('rejects out-of-contract generated code %s',js=>expect(validateArtifact({...artifact(),js})).not.toBeNull());
  it('restricts CSS imports and remote assets',()=>{expect(validateArtifact({...artifact(),css:'@import "https://example.com"'})).not.toBeNull();expect(validateArtifact({...artifact(),css:'div{background:url(https://example.com)}'})).not.toBeNull();});
  it('bounds messages and rejects malformed tap histories',()=>{
    expect(validState(initialLabState())).toBe(true);
    expect(validState({...initialLabState(),history:[{id:'1',hand:'left',at:1,offsetMs:NaN}]})).toBe(false);
    expect(validState({...initialLabState(),history:Array(501).fill({id:'1',hand:'left',at:1,offsetMs:0})})).toBe(false);
    expect(validState({...initialLabState(),settings:{...initialLabState().settings,bpm:0}})).toBe(false);
  });
  it('escapes state across the script boundary and installs restrictive frame policy',()=>{
    const state=initialLabState();state.settings.appearance='</script><script>alert(1)</script>';
    const doc=frameDocument(artifact(),state,'test-channel');
    expect(doc).not.toContain(state.settings.appearance);
    expect(doc).toContain("connect-src 'none'");expect(doc).toContain("default-src 'none'");expect(doc).toContain('event.source!==parent');
  });
});
