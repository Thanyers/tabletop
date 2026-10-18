export async function watchDetails(page){
 const starter=page.getByTestId('watch-demo');
 if(await starter.isVisible())await starter.click();
 else await page.getByRole('button',{name:'Watch demo',exact:true}).click();
 await page.getByLabel('Demo story',{exact:true}).selectOption('details');
}
