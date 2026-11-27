import { expect, it } from "vitest";
import { createElement } from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { TagChoices } from "../ui/src/screens/Tags.tsx";
import { fixtureTags } from "./libby-lists-fixtures.ts";

it("displays the Libby names and the selected state", () => {
  const html = renderToStaticMarkup(
    createElement(TagChoices, { tags: fixtureTags, selected: ["a", "c"], onToggle() {} }),
  );
  expect(html).toContain("⭐ Favorite");
  expect(html).toContain("🎧 Audio");
  expect(html).toContain("To read");
  expect(html.match(/checked=""/g)).toHaveLength(2);
  expect(html).not.toContain("🏷");
});

it("updates the displayed selection when a tag is checked and unchecked", () => {
  let selected = [];
  const onToggle = (id) => {
    selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
  };
  const render = () => TagChoices({ tags: fixtureTags, selected, onToggle });
  const checkbox = render().props.children[1].props.children[0];
  checkbox.props.onChange();
  expect(selected).toEqual(["a"]);
  expect(render().props.children[1].props.children[0].props.checked).toBe(true);
  expect(render().props.children[2].props.children[0].props.checked).toBe(false);
  render().props.children[1].props.children[0].props.onChange();
  expect(render().props.children[1].props.children[0].props.checked).toBe(false);
});
